#!/usr/bin/env python3
"""Apuração Brasil 2026 v0.4.0 — servidor stdlib, cache central e dados oficiais do TSE."""
from __future__ import annotations
import argparse,gzip,hashlib,json,mimetypes,os,socket,subprocess,sys,threading,time,unicodedata,urllib.error,urllib.request,webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs,urlparse

ROOT=Path(__file__).resolve().parent; STATIC=ROOT/"static"; CACHE=ROOT/"cache"; CACHE.mkdir(exist_ok=True)
CFG0={"title":"Apuração Brasil 2026","host":"0.0.0.0","port":8088,"default_round":2,"poll_seconds":15,
"selection_poll_seconds":20,"exterior_poll_seconds":30,"country_poll_seconds":60,"states_poll_seconds":120,
"cache_seconds":10,"states_cache_seconds":90,"country_cache_seconds":45,"pause_when_hidden":True,"enable_test_mode":True,
"tse_base":"https://resultados.tse.jus.br/oficial","tse_cycle":"ele2026"}
CFG=dict(CFG0)
try: CFG.update(json.loads((ROOT/"config.json").read_text("utf-8")))
except Exception: pass
BASE=CFG["tse_base"].rstrip("/"); CYCLE=CFG["tse_cycle"]
UFS={"ac":"Acre","al":"Alagoas","am":"Amazonas","ap":"Amapá","ba":"Bahia","ce":"Ceará","df":"Distrito Federal","es":"Espírito Santo","go":"Goiás","ma":"Maranhão","mg":"Minas Gerais","ms":"Mato Grosso do Sul","mt":"Mato Grosso","pa":"Pará","pb":"Paraíba","pe":"Pernambuco","pi":"Piauí","pr":"Paraná","rj":"Rio de Janeiro","rn":"Rio Grande do Norte","ro":"Rondônia","rr":"Roraima","rs":"Rio Grande do Sul","sc":"Santa Catarina","se":"Sergipe","sp":"São Paulo","to":"Tocantins"}

class DataError(Exception):
    def __init__(self,msg,status=503): super().__init__(msg); self.status=status

def i(v):
    try: return int("".join(c for c in str(v or "") if c.isdigit() or c=="-") or 0)
    except: return 0
def f(v):
    try: return float(str(v or "").replace(".","").replace(",",".") or 0)
    except: return 0.0
def norm(s):
    return "".join(c for c in unicodedata.normalize("NFD",str(s or "").casefold()) if unicodedata.category(c)!="Mn")
def generated(d,h):
    try: return datetime.strptime(f"{d} {h}","%d/%m/%Y %H:%M:%S").isoformat()
    except: return f"{d or ''} {h or ''}".strip() or None

class Fetcher:
    def __init__(self):
        self.mem={}; self.neg={}; self.flight={}; self.lock=threading.Lock()
        self.stats={"network_requests":0,"network_bytes":0,"memory_hits":0,"disk_hits":0,"negative_hits":0,"stale_hits":0,"singleflight_waits":0}
    def path(self,url): return CACHE/(hashlib.sha256(url.encode()).hexdigest()+".json")
    def get(self,url,ttl=None,timeout=12,stale=True):
        ttl=int(CFG["cache_seconds"] if ttl is None else ttl); now=time.time()
        with self.lock:
            n=self.neg.get(url)
            if n and now-n<60: self.stats["negative_hits"]+=1; raise DataError("Arquivo ainda não publicado pelo TSE.",404)
            hit=self.mem.get(url)
            if hit and now-hit[0]<=ttl: self.stats["memory_hits"]+=1; return hit[1],{"cached":True,"stale":False,"fetched_at":hit[0],"cache_layer":"memory"}
        p=self.path(url); disk_obj=None; disk_m=0
        if p.exists():
            try:
                disk_m=p.stat().st_mtime; disk_obj=json.loads(p.read_text("utf-8"))
                if now-disk_m<=ttl:
                    with self.lock: self.mem[url]=(disk_m,disk_obj); self.stats["disk_hits"]+=1
                    return disk_obj,{"cached":True,"stale":False,"fetched_at":disk_m,"cache_layer":"disk"}
            except: disk_obj=None
        with self.lock:
            hit=self.mem.get(url)
            if hit and now-hit[0]<=ttl: self.stats["memory_hits"]+=1; return hit[1],{"cached":True,"stale":False,"fetched_at":hit[0]}
            ev=self.flight.get(url)
            if ev is None: ev=threading.Event(); self.flight[url]=ev; leader=True
            else: self.stats["singleflight_waits"]+=1; leader=False
        if not leader:
            ev.wait(timeout+5); return self.get(url,ttl,timeout,stale)
        req=urllib.request.Request(url,headers={"User-Agent":"ApuracaoBrasil2026/0.4","Accept":"application/json,text/plain,*/*","Cache-Control":"no-cache"})
        try:
            with self.lock: self.stats["network_requests"]+=1
            with urllib.request.urlopen(req,timeout=timeout) as r: raw=r.read()
            obj=json.loads(raw.decode("utf-8-sig")); ts=time.time()
            tmp=p.with_suffix(".tmp"); tmp.write_text(json.dumps(obj,ensure_ascii=False,separators=(",",":")),"utf-8"); tmp.replace(p)
            with self.lock:
                self.mem[url]=(ts,obj); self.neg.pop(url,None); self.stats["network_bytes"]+=len(raw)
            return obj,{"cached":False,"stale":False,"fetched_at":ts,"cache_layer":"network"}
        except urllib.error.HTTPError as e:
            if e.code==404:
                with self.lock: self.neg[url]=time.time()
                raise DataError("Arquivo ainda não publicado pelo TSE.",404)
            if stale and disk_obj is not None:
                with self.lock: self.stats["stale_hits"]+=1
                return disk_obj,{"cached":True,"stale":True,"fetched_at":disk_m,"error":f"HTTP {e.code}"}
            raise DataError(f"TSE respondeu HTTP {e.code}.",502)
        except Exception as e:
            if stale and disk_obj is not None:
                with self.lock: self.stats["stale_hits"]+=1
                return disk_obj,{"cached":True,"stale":True,"fetched_at":disk_m,"error":str(e)}
            raise DataError(f"Não foi possível consultar o TSE: {e}",502)
        finally:
            with self.lock:
                done=self.flight.pop(url,None)
                if done: done.set()
FETCH=Fetcher()

def normalize(raw):
    cargo=(raw.get("carg") or [{}])[0]; s=raw.get("s") or {}; e=raw.get("e") or {}; v=raw.get("v") or {}; cs=[]
    for ag in cargo.get("agr") or []:
        for par in ag.get("par") or []:
            for c in par.get("cand") or []:
                cs.append({"number":str(c.get("n") or ""),"sq":str(c.get("sqcand") or ""),"name":c.get("nmu") or c.get("nm") or "",
                           "full_name":c.get("nm") or "","party":par.get("sg") or "","votes":i(c.get("vap")),"pct":f(c.get("pvap")),"status":c.get("st") or ""})
    cs.sort(key=lambda c:(-c["votes"],-c["pct"],norm(c["name"])))
    vk="vv" if "vv" in v else "vvc"; pk="pvv" if "pvv" in v else "pvvc"
    return {"election":str(raw.get("ele") or ""),"round":i(raw.get("t")) or None,"scope":str(raw.get("cdabr") or "").lower(),
      "generated_at":generated(raw.get("dg"),raw.get("hg")),"final":str(raw.get("tf") or "").lower()=="s",
      "office":{"code":i(cargo.get("cd")),"name":cargo.get("nmn") or "","seats":i(cargo.get("nv")) or 1},
      "sections":{"total":i(s.get("ts")),"counted":i(s.get("st")),"pct":f(s.get("pst"))},
      "electorate":{"total":i(e.get("te")),"turnout":i(e.get("c")),"turnout_pct":f(e.get("pc")),"abstention":i(e.get("a")),"abstention_pct":f(e.get("pa"))},
      "votes":{"valid":i(v.get(vk)),"valid_pct":f(v.get(pk)),"blank":i(v.get("vb")),"blank_pct":f(v.get("pvb")),"null":i(v.get("tvn")),"null_pct":f(v.get("ptvn"))},
      "candidates":cs}

def resolve(round_no):
    url=f"{BASE}/comum/config/ele-c.json"; idx,fm=FETCH.get(url,180)
    federal=state=None; pleito=None
    for pl in idx.get("pl") or []:
        if str(pl.get("c"))!=CYCLE: continue
        ff=ss=None
        for e in pl.get("e") or []:
            if str(e.get("t"))!="1": continue
            if str(e.get("tp"))=="8" and ff is None: ff=e
            if str(e.get("tp"))=="1" and ss is None: ss=e
        if ff and ss:
            pleito=str(pl.get("cd") or ""); federal=str(ff.get("cdt2") if round_no==2 else ff.get("cd") or "")
            state=str(ss.get("cdt2") if round_no==2 else ss.get("cd") or ""); break
    if not federal or federal=="None": federal="6258" if round_no==2 else "6257"
    if not state or state=="None": state="6260" if round_no==2 else "6259"
    return {"federal":federal,"state":state,"pleito":pleito,"round":round_no,"index_url":url,"index_meta":fm}

def result_url(el,scope,office): return f"{BASE}/{CYCLE}/{el}/dados/{scope}/{scope}-c{office:04d}-e{int(el):06d}-u.json"
def municipal_url(el,uf,code,office): return f"{BASE}/{CYCLE}/{el}/dados/{uf}/{uf}{str(code).zfill(5)}-c{office:04d}-e{int(el):06d}-u.json"
def photo_url(el,scope,sq): return f"{BASE}/{CYCLE}/{el}/fotos/{scope}/{sq}.jpeg"
def add_photos(d,el,scope):
    for c in d.get("candidates") or []:
        if c.get("sq"): c["photo_url"]=photo_url(el,scope,c["sq"])
    return d

def result(scope,office,round_no):
    codes=resolve(round_no)
    if office=="presidente": el,oc=codes["federal"],1
    elif office=="governador":
        if scope not in UFS: raise DataError("Selecione uma UF para Governador.",400)
        el,oc=codes["state"],3
    else: raise DataError("Cargo não suportado.",400)
    url=result_url(el,scope,oc); raw,fm=FETCH.get(url); d=normalize(raw); add_photos(d,el,scope); d.update(source_url=url,fetch=fm,resolved=codes); return d

def states(round_no):
    codes=resolve(round_no); el=codes["federal"]
    try: FETCH.get(result_url(el,"br",1),max(15,int(CFG["cache_seconds"])))
    except DataError as e:
        if e.status==404: return {"round":round_no,"election":el,"states":[{"uf":u,"name":n,"available":False,"sections_pct":0} for u,n in UFS.items()],"waiting":True}
        raise
    def one(uf):
        try:
            raw,fm=FETCH.get(result_url(el,uf,1),max(15,int(CFG["cache_seconds"]))); n=normalize(raw)
            return {"uf":uf,"name":UFS[uf],"available":True,"sections_pct":n["sections"]["pct"],"sections_counted":n["sections"]["counted"],"sections_total":n["sections"]["total"],"valid_votes":n["votes"]["valid"],"generated_at":n["generated_at"],"stale":bool(fm.get("stale"))}
        except DataError as e: return {"uf":uf,"name":UFS[uf],"available":False,"message":str(e),"sections_pct":0}
    with ThreadPoolExecutor(max_workers=6) as pool: out=list(pool.map(one,UFS))
    return {"round":round_no,"election":el,"states":out,"source":"Tribunal Superior Eleitoral"}

def exterior_rows():
    p=STATIC/"data"/"exterior_map.json"
    return json.loads(p.read_text("utf-8")) if p.exists() else []
def exterior_catalog():
    by={}
    for r in exterior_rows():
        x=by.setdefault(r["iso"].upper(),{"iso":r["iso"].upper(),"country":r["country"],"cities":[]}); x["cities"].append(r)
    return {"countries":sorted(({"iso":k,"country":v["country"],"cities":len(v["cities"])} for k,v in by.items()),key=lambda x:norm(x["country"])),"city_total":len(exterior_rows()),"source":"Cadastro de locais de votação no exterior / TSE"}
def muni_catalog(round_no):
    el=resolve(round_no)["federal"]; url=f"{BASE}/{CYCLE}/{el}/config/mun-e{int(el):06d}-cm.json"; raw,fm=FETCH.get(url,300); out=[]
    for a in raw.get("abr") or []:
        uf=str(a.get("cd") or "").lower()
        if uf not in set(UFS)|{"zz"}: continue
        for m in a.get("mu") or []:
            if m.get("cd") and m.get("nm"): out.append({"uf":uf,"code":str(m["cd"]),"name":str(m["nm"]).strip(),"capital":str(m.get("c") or "").lower()=="s"})
    return out,url,fm

def capitals(round_no):
    rows,source,fm=muni_catalog(round_no)
    out=[{"type":"city","uf":m["uf"],"code":m["code"],"label":m["name"],"subtitle":f"{UFS.get(m['uf'],m['uf'])} · {m['uf'].upper()}","capital":True} for m in rows if m["uf"] in UFS and m.get("capital")]
    out.sort(key=lambda x:norm(x["label"]))
    return {"round":round_no,"capitals":out,"source_url":source,"fetch":fm}

EXT_BY_CODE={str(r.get("code") or ""):r for r in exterior_rows()}
def municipality(uf,code,office,round_no):
    codes=resolve(round_no); uf=uf.lower()
    if office=="presidente": el,oc=codes["federal"],1
    elif office=="governador" and uf in UFS: el,oc=codes["state"],3
    else: raise DataError("Cargo/UF inválidos.",400)
    url=municipal_url(el,uf,code,oc); raw,fm=FETCH.get(url); d=normalize(raw); add_photos(d,el,uf); d.update(source_url=url,fetch=fm,resolved=codes); return d

def search(q,round_no,office,limit=24):
    qn=norm(q).strip()
    if len(qn)<2:return {"query":q,"results":[]}
    rows=[]
    def score(text,code=""):
        t,c=norm(text),norm(code)
        if qn in (t,c): return 0
        if t.startswith(qn) or c.startswith(qn):return 1
        if qn in t or qn in c:return 2
        return None
    for uf,name in UFS.items():
        sc=score(name,uf)
        if sc is not None: rows.append((sc,name,{"type":"state","uf":uf,"label":name,"subtitle":f"Estado · {uf.upper()}"}))
    if office=="presidente":
        for c in exterior_catalog()["countries"]:
            sc=score(c["country"],c["iso"])
            if sc is not None: rows.append((sc,c["country"],{"type":"country","iso":c["iso"],"label":c["country"],"subtitle":"Exterior · país"}))
    source=None
    try:
        cats,source,_=muni_catalog(round_no)
        for c in cats:
            if office!="presidente" and c["uf"]=="zz": continue
            sc=score(c["name"],c["code"])
            if sc is None: continue
            if c["uf"]=="zz":
                ex=EXT_BY_CODE.get(c["code"],{}); sub=ex.get("country") or "Exterior"
                item={"type":"city","uf":"zz","code":c["code"],"iso":ex.get("iso",""),"label":c["name"],"subtitle":sub}
            else:item={"type":"city","uf":c["uf"],"code":c["code"],"label":c["name"],"subtitle":f"{UFS.get(c['uf'],c['uf'])} · {c['uf'].upper()}"}
            rows.append((sc,c["name"],item))
    except DataError: pass
    rows.sort(key=lambda x:(x[0],norm(x[1]))); return {"query":q,"results":[x[2] for x in rows[:max(1,min(60,int(limit)))]],"catalog_source":source}

class Derived:
    def __init__(self): self.mem={};self.lock=threading.Lock();self.stats={"hits":0,"builds":0}
    def get(self,key,ttl,fn):
        now=time.time()
        with self.lock:
            h=self.mem.get(key)
            if h and now-h[0]<=ttl:self.stats["hits"]+=1;return h[1]
        v=fn()
        with self.lock:self.mem[key]=(time.time(),v);self.stats["builds"]+=1
        return v
DERIVED=Derived()

def aggregate_country(iso,round_no):
    iso=iso.upper(); cat={}
    for r in exterior_rows():cat.setdefault(r["iso"].upper(),{"iso":r["iso"].upper(),"country":r["country"],"cities":[]})["cities"].append(r)
    country=cat.get(iso)
    if not country:raise DataError("País não encontrado.",404)
    codes=resolve(round_no); el=codes["federal"]
    try: FETCH.get(result_url(el,"zz",1),max(20,int(CFG["cache_seconds"])))
    except DataError as e:
        if e.status==404:return {"iso":iso,"country":country["country"],"round":round_no,"election":el,"available":False,"message":"Resultados do Exterior ainda não publicados pelo TSE."}
        raise
    allowed=None
    try: allowed={x["code"] for x in muni_catalog(round_no)[0] if x["uf"]=="zz"}
    except DataError: pass
    cities=[c for c in country["cities"] if allowed is None or c["code"] in allowed]; results=[]; missing=[]
    def one(c):
        try:
            url=municipal_url(el,"zz",c["code"],1); raw,fm=FETCH.get(url,max(20,int(CFG["cache_seconds"])));return c,normalize(raw),fm,url,None
        except DataError as e:return c,None,None,None,str(e)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for c,d,fm,url,err in pool.map(one,cities):
            if d:results.append((c,d,fm,url))
            else:missing.append({"code":c["code"],"city":c["city"],"message":err})
    if not results:return {"iso":iso,"country":country["country"],"round":round_no,"election":el,"available":False,"message":"Resultados deste país ainda não publicados pelo TSE.","missing":missing}
    sec={"total":0,"counted":0,"pct":0}; ele={"total":0,"turnout":0,"abstention":0,"turnout_pct":0,"abstention_pct":0}; votes={"valid":0,"blank":0,"null":0,"valid_pct":0,"blank_pct":0,"null_pct":0}; cand={}
    gens=[]; stale=False; city_rows=[]
    for c,d,fm,url in results:
        gens.append(d["generated_at"]);stale=stale or bool(fm.get("stale"))
        for k in ("total","counted"):sec[k]+=d["sections"][k]
        for k in ("total","turnout","abstention"):ele[k]+=d["electorate"][k]
        for k in ("valid","blank","null"):votes[k]+=d["votes"][k]
        for x in d["candidates"]:
            key=x["number"] or x["sq"] or x["name"]; z=cand.setdefault(key,dict(x));z["votes"]=z.get("votes",0)+x["votes"];z["status"]=""
        city_rows.append({"code":c["code"],"city":c["city"],"sections_pct":d["sections"]["pct"],"valid_votes":d["votes"]["valid"],"generated_at":d["generated_at"],"source_url":url})
    if sec["total"]:sec["pct"]=100*sec["counted"]/sec["total"]
    if ele["total"]:ele["turnout_pct"]=100*ele["turnout"]/ele["total"];ele["abstention_pct"]=100*ele["abstention"]/ele["total"]
    if ele["turnout"]:votes["valid_pct"]=100*votes["valid"]/ele["turnout"];votes["blank_pct"]=100*votes["blank"]/ele["turnout"];votes["null_pct"]=100*votes["null"]/ele["turnout"]
    cs=list(cand.values())
    for x in cs:x["pct"]=100*x["votes"]/votes["valid"] if votes["valid"] else 0
    cs.sort(key=lambda x:(-x["votes"],-x["pct"],norm(x["name"])))
    for x in cs:
        if x.get("sq"): x["photo_url"]=photo_url(el,"zz",x["sq"])
    return {"iso":iso,"country":country["country"],"round":round_no,"election":el,"available":True,"generated_at":max([g for g in gens if g] or [None]),"stale":stale,"sections":sec,"electorate":ele,"votes":votes,"candidates":cs,"cities":city_rows,"missing":missing,"source":"Tribunal Superior Eleitoral"}

def addresses(port):
    a=[]
    try:
        h=socket.gethostname()
        for x in socket.getaddrinfo(h,None,socket.AF_INET):
            ip=x[4][0]
            if not ip.startswith("127.") and ip not in a:a.append(ip)
    except:pass
    try:
        p=subprocess.run(["tailscale","ip","-4"],capture_output=True,text=True,timeout=2)
        if p.returncode==0 and p.stdout.strip():a.append(p.stdout.strip().splitlines()[0])
    except:pass
    return [f"http://{ip}:{port}" for ip in dict.fromkeys(a)]

class H(BaseHTTPRequestHandler):
    server_version="ApuracaoBrasil/0.3"
    def log_message(self,fmt,*args):print(f"[{self.log_date_time_string()}] {self.client_address[0]} {fmt%args}")
    def hdr(self,status=200,ctype="application/json; charset=utf-8",length=None,cache="no-store",extra=None):
        self.send_response(status)
        if ctype:self.send_header("Content-Type",ctype)
        if length is not None:self.send_header("Content-Length",str(length))
        self.send_header("Cache-Control",cache);self.send_header("X-Content-Type-Options","nosniff");self.send_header("X-Frame-Options","SAMEORIGIN")
        for k,v in (extra or {}).items():self.send_header(k,str(v))
        self.end_headers()
    def js(self,obj,status=200,etag=True):
        raw=json.dumps(obj,ensure_ascii=False,separators=(",",":")).encode();tag='"'+hashlib.sha256(raw).hexdigest()[:24]+'"'
        if status==200 and etag and self.headers.get("If-None-Match")==tag:self.hdr(304,None,None,"private, no-cache",{"ETag":tag});return
        payload=raw;extra={"Vary":"Accept-Encoding","ETag":tag}
        if "gzip" in (self.headers.get("Accept-Encoding") or "").lower() and len(raw)>=1024:payload=gzip.compress(raw,5);extra["Content-Encoding"]="gzip"
        self.hdr(status,"application/json; charset=utf-8",len(payload),"private, no-cache",extra);self.wfile.write(payload)
    def err(self,e):
        status=e.status if isinstance(e,DataError) else 500;self.js({"ok":False,"status":status,"message":str(e)},status,False)
    def do_GET(self):
        u=urlparse(self.path);p=u.path;q=parse_qs(u.query)
        try:
            if p=="/api/health":return self.js({"ok":True,"version":"0.4.0","time":datetime.now().isoformat(),"source":BASE,"cache":dict(FETCH.stats),"derived_cache":dict(DERIVED.stats)})
            if p=="/api/meta":
                r=int(q.get("round",[CFG["default_round"]])[0]);codes=resolve(r)
                return self.js({"ok":True,"title":CFG["title"],"version":"0.4.0","round":r,"poll_seconds":CFG["poll_seconds"],"selection_poll_seconds":CFG["selection_poll_seconds"],"exterior_poll_seconds":CFG["exterior_poll_seconds"],"country_poll_seconds":CFG["country_poll_seconds"],"states_poll_seconds":CFG["states_poll_seconds"],"pause_when_hidden":bool(CFG["pause_when_hidden"]),"enable_test_mode":bool(CFG["enable_test_mode"]),"resolved":codes,"source":"Tribunal Superior Eleitoral","source_base":BASE})
            if p=="/api/result":
                r=int(q.get("round",[CFG["default_round"]])[0]);return self.js({"ok":True,"data":result(q.get("scope",["br"])[0].lower(),q.get("office",["presidente"])[0].lower(),r)})
            if p=="/api/states":
                r=int(q.get("round",[CFG["default_round"]])[0]);d=DERIVED.get(("states",r),int(CFG["states_cache_seconds"]),lambda:states(r));return self.js({"ok":True,"data":d})
            if p=="/api/exterior/catalog":return self.js({"ok":True,"data":exterior_catalog()})
            if p=="/api/capitals":
                r=int(q.get("round",[CFG["default_round"]])[0]);return self.js({"ok":True,"data":capitals(r)})
            if p=="/api/exterior/country":
                r=int(q.get("round",[CFG["default_round"]])[0]);iso=q.get("iso",[""])[0].upper();d=DERIVED.get(("country",r,iso),int(CFG["country_cache_seconds"]),lambda:aggregate_country(iso,r));return self.js({"ok":True,"data":d})
            if p=="/api/search":
                r=int(q.get("round",[CFG["default_round"]])[0]);return self.js({"ok":True,"data":search(q.get("q",[""])[0],r,q.get("office",["presidente"])[0].lower(),int(q.get("limit",[24])[0]))})
            if p=="/api/municipality":
                r=int(q.get("round",[CFG["default_round"]])[0]);code=q.get("code",[""])[0]
                if not code:raise DataError("Código do município/local não informado.",400)
                return self.js({"ok":True,"data":municipality(q.get("uf",[""])[0],code,q.get("office",["presidente"])[0].lower(),r)})
            return self.static(p)
        except Exception as e:self.err(e)
    def static(self,p):
        if p=="/":p="/index.html"
        target=(STATIC/p.lstrip("/")).resolve()
        if STATIC.resolve() not in target.parents and target!=STATIC.resolve():raise DataError("Caminho inválido.",403)
        if not target.is_file():raise DataError("Arquivo não encontrado.",404)
        raw=target.read_bytes();ctype=mimetypes.guess_type(str(target))[0] or "application/octet-stream";cache="public, max-age=86400" if p.startswith("/data/") or p.startswith("/icons/") else "no-cache"
        self.hdr(200,ctype,len(raw),cache);self.wfile.write(raw)

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--host",default=os.getenv("APURACAO_HOST",CFG["host"]));ap.add_argument("--port",type=int,default=int(os.getenv("PORT",os.getenv("APURACAO_PORT",CFG["port"]))));ap.add_argument("--open",action="store_true");a=ap.parse_args()
    s=ThreadingHTTPServer((a.host,a.port),H)
    print("\n=== APURAÇÃO BRASIL 2026 v0.4.0 ===");print("Fonte: TSE — resultados.tse.jus.br");print(f"Local: http://127.0.0.1:{a.port}")
    for x in addresses(a.port):print("Rede: ",x)
    print("Modo econômico: cache central, single-flight, ETag/gzip e atualização inteligente.\nCtrl+C para encerrar.\n")
    if a.open:threading.Timer(1,lambda:webbrowser.open(f"http://127.0.0.1:{a.port}")).start()
    try:s.serve_forever()
    except KeyboardInterrupt:print("\nEncerrando...")
    finally:s.server_close()
if __name__=="__main__":main()
