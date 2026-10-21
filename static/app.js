(() => {
  'use strict';

  const UF_NAMES = {
    ac:'Acre',al:'Alagoas',am:'Amazonas',ap:'Amapá',ba:'Bahia',ce:'Ceará',df:'Distrito Federal',es:'Espírito Santo',go:'Goiás',
    ma:'Maranhão',mg:'Minas Gerais',ms:'Mato Grosso do Sul',mt:'Mato Grosso',pa:'Pará',pb:'Paraíba',pe:'Pernambuco',pi:'Piauí',
    pr:'Paraná',rj:'Rio de Janeiro',rn:'Rio Grande do Norte',ro:'Rondônia',rr:'Roraima',rs:'Rio Grande do Sul',sc:'Santa Catarina',
    se:'Sergipe',sp:'São Paulo',to:'Tocantins'
  };

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const esc = (s='') => String(s).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const fmtInt = n => new Intl.NumberFormat('pt-BR').format(Number(n || 0));
  const fmtPct = n => `${Number(n || 0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
  const fmtTime = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'medium'});
  };

  const state = {
    round: 2,
    office: 'presidente',
    view: 'brasil',
    meta: null,
    pollTimer: null,
    statePollTimer: null,
    stateSnapshot: null,
    lastStatesAt: 0,
    httpCache: new Map(),
    brazilMap: null,
    worldGeo: null,
    countryCatalog: [],
    selectedState: null,
    selectedCountry: null,
    currentSelection: {type:'national'},
    searchTimer: null,
    searchItems: [],
    searchFocus: -1,
    candidateSort: 'votes',
  };

  async function apiGet(url, timeoutMs=20000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const previous = state.httpCache.get(url);
    const headers = {};
    if (previous?.etag) headers['If-None-Match'] = previous.etag;
    try {
      const r = await fetch(url,{cache:'no-store',signal:ctl.signal,headers});
      if (r.status === 304 && previous) return {...previous.body,_notModified:true};
      let body;
      try { body = await r.json(); } catch { body = {message:`HTTP ${r.status}`}; }
      if (!r.ok || body.ok === false) {
        const e = new Error(body.message || `HTTP ${r.status}`);
        e.status = r.status;
        throw e;
      }
      const etag = r.headers.get('ETag');
      if (etag) state.httpCache.set(url,{etag,body});
      return body;
    } finally { clearTimeout(timer); }
  }

  function setLive(mode,text) {
    const el = $('#liveState');
    el.className = `live-state ${mode}`;
    $('b',el).textContent = text;
  }

  function updateUiTime() {
    $('#lastUiUpdate').textContent = `interface atualizada ${new Date().toLocaleTimeString('pt-BR')}`;
  }

  function waitingHtml() { return $('#waitingTemplate').content.firstElementChild.outerHTML; }
  function errorHtml(message, waiting=false) {
    if (waiting) return waitingHtml();
    return `<div class="error-box"><h3>Não foi possível carregar</h3><p>${esc(message)}</p></div>`;
  }

  function sortCandidates(candidates=[]) {
    const copy = [...candidates];
    if (state.candidateSort === 'alpha') {
      copy.sort((a,b) => String(a.name||'').localeCompare(String(b.name||''),'pt-BR',{sensitivity:'base'}) || Number(b.votes||0)-Number(a.votes||0));
    } else if (state.candidateSort === 'number') {
      copy.sort((a,b) => Number(a.number||999999)-Number(b.number||999999) || Number(b.votes||0)-Number(a.votes||0));
    } else {
      copy.sort((a,b) => Number(b.votes||0)-Number(a.votes||0) || Number(b.pct||0)-Number(a.pct||0) || String(a.name||'').localeCompare(String(b.name||''),'pt-BR',{sensitivity:'base'}));
    }
    return copy;
  }

  function candidateRows(candidates=[]) {
    if (!candidates.length) return '<div class="load-note">Nenhum candidato consta no arquivo deste recorte.</div>';
    const voteOrder = [...candidates].sort((a,b) => Number(b.votes||0)-Number(a.votes||0) || Number(b.pct||0)-Number(a.pct||0));
    const rank = new Map(voteOrder.map((c,i)=>[String(c.sq||c.number||c.name),i+1]));
    return sortCandidates(candidates).map(c => {
      const pos = rank.get(String(c.sq||c.number||c.name)) || 0;
      return `
      <div class="candidate-row ${pos===1 && Number(c.votes||0)>0 ? 'leader' : ''}">
        <div class="candidate-ident">
          <div class="candidate-number">${esc(c.number || '—')}</div>
          <div>
            <div class="candidate-title-line"><b>${esc(c.name || '—')}</b>${pos ? `<span class="rank-badge">${pos}º</span>` : ''}${pos===1 && Number(c.votes||0)>0 ? '<span class="leader-badge">LIDERANDO</span>' : ''}</div>
            <small>${esc(c.party || '—')}</small>
            ${c.status ? `<div class="official-status">Situação no arquivo: ${esc(c.status)}</div>` : ''}
          </div>
        </div>
        <div class="candidate-numbers">
          <strong>${fmtPct(c.pct)}</strong>
          <small>${fmtInt(c.votes)} votos</small>
        </div>
      </div>`;
    }).join('');
  }

  function candidateHeadHtml() {
    return `<div class="candidate-head"><b>Candidaturas no arquivo oficial</b><div class="candidate-tools"><span>Fonte: TSE</span><select class="candidate-sort" aria-label="Ordenar candidatos"><option value="votes" ${state.candidateSort==='votes'?'selected':''}>Mais votados</option><option value="alpha" ${state.candidateSort==='alpha'?'selected':''}>A–Z</option><option value="number" ${state.candidateSort==='number'?'selected':''}>Número</option></select></div></div>`;
  }

  function bindCandidateSort(candidates=[]) {
    const select = $('.candidate-sort',$('#detailPanel'));
    const rows = $('.candidate-rows',$('#detailPanel'));
    if (!select || !rows) return;
    select.value = state.candidateSort;
    select.addEventListener('change',()=>{
      state.candidateSort = select.value;
      rows.innerHTML = candidateRows(candidates);
    });
  }

  function detailHtml(d,title,subtitle='') {
    const stale = d.fetch?.stale || d.stale;
    const sourceUrl = d.source_url || '';
    return `
      <div class="detail-top">
        <div>
          <span class="eyebrow">${esc(d.office?.name || (state.office==='governador'?'Governador':'Presidente'))}</span>
          <h3>${esc(title)}</h3>
          <p>${esc(subtitle || `Atualizado ${fmtTime(d.generated_at)}`)}</p>
        </div>
        <div class="mini-progress">${fmtPct(d.sections?.pct)}<small>seções</small></div>
      </div>
      ${stale ? '<div class="stale-note">⚠ Exibindo o último dado oficial salvo porque a consulta atual falhou.</div>' : ''}
      <div class="mini-stats">
        <div class="mini-stat"><span>Seções</span><b>${fmtInt(d.sections?.counted)} / ${fmtInt(d.sections?.total)}</b></div>
        <div class="mini-stat"><span>Votos válidos</span><b>${fmtInt(d.votes?.valid)}</b></div>
        <div class="mini-stat"><span>Comparecimento</span><b>${fmtInt(d.electorate?.turnout)}</b></div>
        <div class="mini-stat"><span>Abstenção</span><b>${fmtInt(d.electorate?.abstention)}</b></div>
      </div>
      <div class="candidate-list">
        ${candidateHeadHtml()}
        <div class="candidate-rows">${candidateRows(d.candidates)}</div>
      </div>
      ${sourceUrl ? `<a class="source-link" href="${esc(sourceUrl)}" target="_blank" rel="noreferrer">Abrir JSON oficial do TSE ↗</a>` : ''}`;
  }

  function setOverlay(title,subline,pct=null,countText='—',eyebrow=null) {
    $('#mapHontent = title;
    $('#mapSubline').textContent = subline || '';
    $('#mapEyebrow').textContent = eyebrow || (state.office==='governador'?'Governador':'Presidente da República');
    $('#mapProgress').textContent = pct == null ? '—' : fmtPct(pct);
    $('#mapProgressCount').textContent = countText || '—';
  }

  function overlayFromData(d,title) {
    setOverlay(
      title,
      `Arquivo gerado ${fmtTime(d.generated_at)}${d.final ? ' · totalização final' : ''}`,
      d.sections?.pct,
      `${fmtInt(d.sections?.counted)} / ${fmtInt(d.sections?.total)}`,
      d.office?.name || null
    );
  }

  async function loadMeta() {
    const b = await apiGet(`/api/meta?round=${state.round}`);
    state.meta = b;
    if (!b.enable_test_mode) $('#round1Btn').classList.add('hidden');
    return b;
  }

  async function loadNational(silent=false) {
    const box = $('#detailPanel');
    if (!silent) box.innerHTML = '<div class="skeleton tall"></div>';
    try {
      if (!state.meta || state.meta.round !== state.round) await loadMeta();
      const b = await apiGet(`/api/result?office=presidente&scope=br&round=${state.round}`);
      const d = b.data;
      box.innerHTML = detailHtml(d,'Brasil',`Presidente · atualizado ${fmtTime(d.generated_at)}`);
      bindCandidateSort(d.candidates);
      overlayFromData(d,'Brasil');
      setLive(d.fetch?.stale?'stale':'live',d.fetch?.stale?'Último dado':'TSE online');
      updateUiTime();
    } catch(e) {
      const waiting = e.status===404 && state.round===2;
      if (silent) { setLive(waiting?'waiting':'stale',waiting?'Aguardando TSE':'Último dado'); return; }
      box.innerHTML = errorHtml(e.message,waiting);
      setOverlay('Brasil',waiting?'Aguardando publicação do arquivo oficial':e.message,null,'—');
      setLive(waiting?'waiting':'error',waiting?'Aguardando TSE':'Falha');
    }
  }

  function governorLanding() {
    state.currentSelection = {type:'governor-landing'};
    $('#detailPanel').innerHTML = `<div class="empty-state"><div><b>Selecione um estado</b><p>Clique em uma UF no mapa ou pesquise um estado/cidade para abrir o arquivo oficial de Governador.</p></div></div>`;
    setOverlay('Brasil','Selecione uma UF para consultar Governador',null,'—','Governador');
  }

  async function loadStates(silent=false) {
    try {
      const b = await apiGet(`/api/states?round=${state.round}`,30000);
      state.stateSnapshot = b.data;
      state.lastStatesAt = Date.now();
      renderBrazilMap();
    } catch(e) {
      if (!silent) state.stateSnapshot = null;
      renderBrazilMap();
    }
  }

  async function initBrazil() {
    if (!state.brazilMap) state.brazilMap = await fetch('/data/brazil_map.json').then(r=>r.json());
    renderBrazilMap();
  }

  function stateDatum(uf) {
    return state.stateSnapshot?.states?.find(x => x.uf === uf) || null;
  }

  function renderBrazilMap() {
    if (!state.brazilMap) return;
    const svg = $('#brasilMap');
    const paths = state.brazilMap.map(item => {
      const uf = item.uf.toLowerCase();
      const d = stateDatum(uf);
      const a = d?.available ? (0.2 + Math.min(100,Number(d.sections_pct||0))/100*0.66) : 0.08;
      const cls = `br-state ${d?.available===false?'unavailable':''} ${state.selectedState===uf?'selected':''}`;
      return `<path class="${cls}" data-uf="${uf}" d="${item.d}" style="--a:${a.toFixed(3)}"></path>`;
    }).join('');
    const labels = state.brazilMap.map(item => {
      const uf = item.uf.toLowerCase();
      const small = ['df','se','al','es','rj'].includes(uf) ? ' small' : '';
      return `<text class="br-label${small}" x="${item.center[0]}" y="${item.center[1]}">${item.uf}</text>`;
    }).join('');
    svg.innerHTML = `<g transform="translate(5,0)">${paths}${labels}</g>`;
    $$('.br-state',svg).forEach(p => {
      const uf = p.dataset.uf;
      const d = stateDatum(uf);
      p.addEventListener('click',()=>selectState(uf));
      p.addEventListener('mousemove',ev => showTooltip(ev,`${UF_NAMES[uf]}${d?.available?` · ${fmtPct(d.sections_pct)} seções`:''}`));
      p.addEventListener('mouseleave',hideTooltip);
    });
  }

  async function selectState(uf,silent=false) {
    state.selectedState = uf;
    state.selectedCountry = null;
    state.currentSelection = {type:'state',uf};
    if (state.view !== 'brasil') setView('brasil',false);
    renderBrazilMap();
    const box = $('#detailPanel');
    if (!silent) box.innerHTML = '<div class="skeleton tall"></div>';
    const office = state.office;
    try {
      const b = await apiGet(`/api/result?office=${office}&scope=${encodeURIComponent(uf)}&round=${state.round}`);
      const d = b.data;
      box.innerHTML = detailHtml(d,UF_NAMES[uf],`${office==='governador'?'Governador':'Presidente'} · ${uf.toUpperCase()} · atualizado ${fmtTime(d.generated_at)}`);
      bindCandidateSort(d.candidates);
      overlayFromData(d,UF_NAMES[uf]);
      setLive(d.fetch?.stale?'stale':'live',d.fetch?.stale?'Último dado':'TSE online');
      updateUiTime();
    } catch(e) {
      const waiting = e.status===404 && state.round===2;
      if (silent) { setLive(waiting?'waiting':'stale',waiting?'Aguardando TSE':'Último dado'); return; }
      box.innerHTML = errorHtml(e.message,waiting);
      setOverlay(UF_NAMES[uf],waiting?'Aguardando arquivo oficial':e.message,null,'—');
    }
  }

  function geomPath(geom) {
    if (!geom) return '';
    const polys = geom.type==='Polygon' ? [geom.coordinates] : geom.type==='MultiPolygon' ? geom.coordinates : [];
    const project = ([lon,lat]) => [(lon+180)/360*1000,(90-lat)/180*500];
    let d='';
    for (const poly of polys) {
      for (const ring of poly) {
        let prev=null,started=false;
        for (const pt of ring) {
          const [x,y] = project(pt);
          if (!prev || Math.abs(x-prev[0])>460) d += `M${x.toFixed(1)},${y.toFixed(1)}`;
          else d += `L${x.toFixed(1)},${y.toFixed(1)}`;
          prev=[x,y]; started=true;
        }
        if (started) d += 'Z';
      }
    }
    return d;
  }

  async function initWorld() {
    if (!state.countryCatalog.length) {
      const cat = await apiGet('/api/exterior/catalog');
      state.countryCatalog = cat.data.countries;
    }
    if (!state.worldGeo) state.worldGeo = await fetch('/data/world.geojson').then(r=>r.json());
    renderWorld();
  }

  function renderWorld() {
    if (!state.worldGeo) return;
    const svg = $('#worldMap');
    const catalog = new Map(state.countryCatalog.map(x => [x.iso,x]));
    svg.innerHTML = state.worldGeo.features.map(f => {
      const iso = String(f.properties.iso2 || '').toUpperCase();
      const c = catalog.get(iso);
      return `<path class="country-path ${c?'has-vote':''} ${state.selectedCountry===iso?'selected':''}" data-iso="${esc(iso)}" data-name="${esc(c?.country || f.properties.name || '')}" data-cities="${c?.cities || 0}" d="${geomPath(f.geometry)}"></path>`;
    }).join('');
    $$('.country-path.has-vote',svg).forEach(p => {
      p.addEventListener('click',()=>selectCountry(p.dataset.iso));
      p.addEventListener('mousemove',ev=>showTooltip(ev,`${p.dataset.name} · ${p.dataset.cities} local(is)`));
      p.addEventListener('mouseleave',hideTooltip);
    });
  }

  async function loadExteriorTotal(silent=false) {
    state.selectedCountry = null;
    state.selectedState = null;
    state.currentSelection = {type:'exterior-total'};
    renderWorld();
    const box = $('#detailPanel');
    if (!silent) box.innerHTML = '<div class="skeleton tall"></div>';
    try {
      const b = await apiGet(`/api/result?office=presidente&scope=zz&round=${state.round}`);
      const d = b.data;
      box.innerHTML = detailHtml(d,'Exterior · total',`Presidente · exterior · atualizado ${fmtTime(d.generated_at)}`) + '<div class="load-note">Clique em um país no mapa para somar apenas seus locais de votação.</div>';
      overlayFromData(d,'Exterior');
      setLive(d.fetch?.stale?'stale':'live',d.fetch?.stale?'Último dado':'TSE online');
      updateUiTime();
    } catch(e) {
      const waiting = e.status===404 && state.round===2;
      if (silent) { setLive(waiting?'waiting':'stale',waiting?'Aguardando TSE':'Último dado'); return; }
      box.innerHTML = errorHtml(e.message,waiting);
      setOverlay('Exterior',waiting?'Aguardando publicação do arquivo oficial':e.message,null,'—');
    }
  }

  async function selectCountry(iso,silent=false) {
    if (state.office !== 'presidente') return;
    state.selectedCountry = iso;
    state.selectedState = null;
    state.currentSelection = {type:'country',iso};
    if (state.view !== 'exterior') await setView('exterior',false);
    renderWorld();
    const box = $('#detailPanel');
    if (!silent) box.innerHTML = '<div class="skeleton tall"></div>';
    try {
      const b = await apiGet(`/api/exterior/country?iso=${encodeURIComponent(iso)}&round=${state.round}`,45000);
      const d = b.data;
      if (!d.available) {
        box.innerHTML = errorHtml(d.message || 'Dados ainda não disponíveis.',state.round===2);
        setOverlay(d.country || iso,d.message || 'Dados indisponíveis',null,'—');
        return;
      }
      const fake = {office:{name:'Presidente'},sections:d.sections,electorate:d.electorate,votes:d.votes,candidates:d.candidates,generated_at:d.generated_at,stale:d.stale};
      box.innerHTML = detailHtml(fake,d.country,`Presidente · exterior · atualizado ${fmtTime(d.generated_at)}`) + `
        <div class="city-list">
          <div class="candidate-head"><b>Locais somados</b><span>${d.cities.length} com dados</span></div>
          ${d.cities.map(c=>`<button class="search-item city-direct" data-code="${esc(c.code)}" data-name="${esc(c.city)}"><b>${esc(c.city)}</b><span>${fmtPct(c.sections_pct)} · ${fmtInt(c.valid_votes)} válidos</span></button>`).join('')}
        </div>
        ${d.missing?.length?`<div class="load-note">${d.missing.length} local(is) ainda sem arquivo disponível.</div>`:''}`;
      bindCandidateSort(d.candidates);
      $$('.city-direct',box).forEach(btn=>btn.addEventListener('click',()=>selectMunicipality({type:'city',uf:'zz',code:btn.dataset.code,iso,label:btn.dataset.name,subtitle:d.country})));
      setOverlay(d.country,`${d.cities.length} local(is) com arquivo disponível`,d.sections?.pct,`${fmtInt(d.sections?.counted)} / ${fmtInt(d.sections?.total)}`);
      setLive(d.stale?'stale':'live',d.stale?'Último dado':'TSE online');
      updateUiTime();
    } catch(e) {
      const waiting = e.status===404 && state.round===2;
      if (silent) { setLive(waiting?'waiting':'stale',waiting?'Aguardando TSE':'Último dado'); return; }
      box.innerHTML = errorHtml(e.message,waiting);
      setOverlay(iso,waiting?'Aguardando arquivo oficial':e.message,null,'—');
    }
  }

  async function selectMunicipality(item,silent=false) {
    state.selectedCountry = item.iso || null;
    state.selectedState = item.uf !== 'zz' ? item.uf : null;
    state.currentSelection = {type:'city',item};
    if (item.uf === 'zz') {
      if (state.office !== 'presidente') return;
      if (state.view !== 'exterior') await setView('exterior',false);
      renderWorld();
    } else {
      if (state.view !== 'brasil') await setView('brasil',false);
      renderBrazilMap();
    }
    const box = $('#detailPanel');
    if (!silent) box.innerHTML = '<div class="skeleton tall"></div>';
    try {
      const b = await apiGet(`/api/municipality?uf=${encodeURIComponent(item.uf)}&code=${encodeURIComponent(item.code)}&office=${state.office}&round=${state.round}`,30000);
      const d = b.data;
      const suffix = item.uf==='zz' ? (item.subtitle || 'Exterior') : `${UF_NAMES[item.uf]} · ${item.uf.toUpperCase()}`;
      box.innerHTML = detailHtml(d,item.label,`${suffix} · atualizado ${fmtTime(d.generated_at)}`);
      bindCandidateSort(d.candidates);
      overlayFromData(d,item.label);
      setLive(d.fetch?.stale?'stale':'live',d.fetch?.stale?'Último dado':'TSE online');
      updateUiTime();
    } catch(e) {
      const waiting = e.status===404 && state.round===2;
      if (silent) { setLive(waiting?'waiting':'stale',waiting?'Aguardando TSE':'Último dado'); return; }
      box.innerHTML = errorHtml(e.message,waiting);
      setOverlay(item.label,waiting?'Aguardando arquivo oficial':e.message,null,'—');
    }
  }

  function showTooltip(ev,text) {
    const t = $('#mapTooltip');
    t.textContent = text;
    t.classList.remove('hidden');
    t.style.left = `${ev.clientX+12}px`;
    t.style.top = `${ev.clientY+12}px`;
  }
  function hideTooltip(){ $('#mapTooltip').classList.add('hidden'); }

  async function setView(view,reset=true) {
    if (view==='exterior' && state.office!=='presidente') return;
    state.view = view;
    $$('.view-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    $('#brasilMapWrap').classList.toggle('active',view==='brasil');
    $('#worldMapWrap').classList.toggle('active',view==='exterior');
    if (view==='brasil') {
      await initBrazil();
      if (!state.stateSnapshot) await loadStates();
      if (reset) {
        state.selectedState=null; state.selectedCountry=null; renderBrazilMap();
        if (state.office==='presidente') { state.currentSelection={type:'national'}; await loadNational(); }
        else governorLanding();
      }
    } else {
      await initWorld();
      if (reset) await loadExteriorTotal();
    }
  }

  async function setOffice(office) {
    if (state.office===office) return;
    state.office = office;
    state.selectedState = null; state.selectedCountry = null;
    $$('.office-btn').forEach(b=>b.classList.toggle('active',b.dataset.office===office));
    const exteriorBtn = $('.view-btn[data-view="exterior"]');
    exteriorBtn.disabled = office !== 'presidente';
    if (office==='governador' && state.view==='exterior') await setView('brasil',false);
    if (office==='governador') governorLanding();
    else if (state.view==='brasil') { state.currentSelection={type:'national'}; await loadNational(); }
    else await loadExteriorTotal();
    $('#placeSearch').placeholder = office==='presidente' ? 'Pesquisar cidade, estado ou país…' : 'Pesquisar cidade ou estado…';
    closeSearch();
    renderBrazilMap(); renderWorld();
  }

  function updateRoundUi() {
    $('#round2Btn').classList.toggle('active',state.round===2);
    $('#round1Btn').classList.toggle('active',state.round===1);
    $('#testBanner').classList.toggle('hidden',state.round!==1);
  }

  async function setRound(round) {
    state.round = round;
    state.meta = null;
    state.stateSnapshot = null;
    updateRoundUi();
    await loadMeta().catch(()=>{});
    await loadStates();
    await refreshCurrent(true,false);
    startPolling();
  }

  async function refreshCurrent(forceReset=false,silent=true) {
    const sel = forceReset ? (state.office==='presidente' ? (state.view==='exterior'?{type:'exterior-total'}:{type:'national'}) : {type:'governor-landing'}) : state.currentSelection;
    if (sel.type==='national') return loadNational(silent);
    if (sel.type==='exterior-total') return loadExteriorTotal(silent);
    if (sel.type==='state') return selectState(sel.uf,silent);
    if (sel.type==='country') return selectCountry(sel.iso,silent);
    if (sel.type==='city') return selectMunicipality(sel.item,silent);
    if (sel.type==='governor-landing') return governorLanding();
  }

  function renderSearchResults(items) {
    state.searchItems = items;
    state.searchFocus = -1;
    const box = $('#searchResults');
    if (!items.length) {
      box.innerHTML = '<div class="search-empty">Nenhum local encontrado.</div>';
      box.classList.remove('hidden');
      return;
    }
    box.innerHTML = items.map((item,i)=>`<button class="search-item" data-index="${i}"><b>${esc(item.label)}</b><span>${esc(item.subtitle || item.type)}</span></button>`).join('');
    box.classList.remove('hidden');
    $$('.search-item',box).forEach(btn=>btn.addEventListener('click',()=>chooseSearchItem(items[Number(btn.dataset.index)])));
  }

  async function searchPlaces(q) {
    if (q.trim().length<2) { closeSearch(); return; }
    try {
      const b = await apiGet(`/api/search?q=${encodeURIComponent(q)}&round=${state.round}&office=${state.office}&limit=28`,25000);
      renderSearchResults(b.data.results || []);
    } catch(e) {
      $('#searchResults').innerHTML = `<div class="search-empty">${esc(e.message)}</div>`;
      $('#searchResults').classList.remove('hidden');
    }
  }

  function closeSearch() {
    $('#searchResults').classList.add('hidden');
    state.searchItems=[]; state.searchFocus=-1;
  }

  function clearSearch() {
    $('#placeSearch').value='';
    $('#clearSearch').classList.add('hidden');
    closeSearch();
  }

  async function chooseSearchItem(item) {
    if (!item) return;
    $('#placeSearch').value = item.label;
    $('#clearSearch').classList.remove('hidden');
    closeSearch();
    if (item.type==='state') return selectState(item.uf);
    if (item.type==='country') return selectCountry(item.iso);
    if (item.type==='city') return selectMunicipality(item);
  }

  function setupSearch() {
    const input = $('#placeSearch');
    input.addEventListener('input',()=>{
      const q=input.value;
      $('#clearSearch').classList.toggle('hidden',!q);
      clearTimeout(state.searchTimer);
      state.searchTimer=setTimeout(()=>searchPlaces(q),220);
    });
    input.addEventListener('keydown',ev=>{
      if ($('#searchResults').classList.contains('hidden') || !state.searchItems.length) return;
      if (ev.key==='ArrowDown' || ev.key==='ArrowUp') {
        ev.preventDefault();
        const dir=ev.key==='ArrowDown'?1:-1;
        state.searchFocus=(state.searchFocus+dir+state.searchItems.length)%state.searchItems.length;
        $$('.search-item',$('#searchResults')).forEach((el,i)=>el.classList.toggle('focused',i===state.searchFocus));
      } else if (ev.key==='Enter') {
        ev.preventDefault();
        chooseSearchItem(state.searchItems[state.searchFocus>=0?state.searchFocus:0]);
      } else if (ev.key==='Escape') closeSearch();
    });
    $('#clearSearch').addEventListener('click',()=>{clearSearch();input.focus();});
    document.addEventListener('click',ev=>{ if (!ev.target.closest('.search-box')) closeSearch(); });
  }

  function shouldPoll() {
    return navigator.onLine && (!state.meta?.pause_when_hidden || !document.hidden);
  }

  function currentPollSeconds() {
    const type = state.currentSelection?.type || 'national';
    if (type === 'country') return Math.max(30,Number(state.meta?.country_poll_seconds || 60));
    if (type === 'exterior-total') return Math.max(20,Number(state.meta?.exterior_poll_seconds || 30));
    if (type === 'state' || type === 'city') return Math.max(15,Number(state.meta?.selection_poll_seconds || 20));
    if (type === 'governor-landing') return 120;
    return Math.max(10,Number(state.meta?.poll_seconds || 15));
  }

  function stopPolling() {
    clearTimeout(state.pollTimer);
    clearTimeout(state.statePollTimer);
    state.pollTimer = null;
    state.statePollTimer = null;
  }

  function scheduleCurrentPoll(delaySeconds=null) {
    clearTimeout(state.pollTimer);
    if (!shouldPoll()) return;
    const seconds = delaySeconds ?? currentPollSeconds();
    state.pollTimer = setTimeout(async()=>{
      try { await refreshCurrent(false,true); } catch {}
      scheduleCurrentPoll();
    },seconds*1000);
  }

  function scheduleStatesPoll(delaySeconds=null) {
    clearTimeout(state.statePollTimer);
    if (!shouldPoll()) return;
    const seconds = Math.max(60,Number(state.meta?.states_poll_seconds || 120));
    state.statePollTimer = setTimeout(async()=>{
      if (state.view === 'brasil') { try { await loadStates(true); } catch {} }
      scheduleStatesPoll();
    },(delaySeconds ?? seconds)*1000);
  }

  function startPolling() {
    stopPolling();
    if (!shouldPoll()) return;
    scheduleCurrentPoll();
    scheduleStatesPoll();
  }

  async function resumeAfterPause() {
    if (!navigator.onLine) return;
    try {
      const stateAge = Date.now() - (state.lastStatesAt || 0);
      const stateEvery = Math.max(60,Number(state.meta?.states_poll_seconds || 120))*1000;
      if (state.view === 'brasil' && stateAge >= stateEvery) await loadStates(true);
      await refreshCurrent(false,true);
    } catch {}
    startPolling();
  }

  function setupEvents() {
    $('#round2Btn').addEventListener('click',()=>setRound(2));
    $('#round1Btn').addEventListener('click',()=>setRound(1));
    $$('.office-btn').forEach(b=>b.addEventListener('click',()=>setOffice(b.dataset.office)));
    $$('.view-btn').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view,true)));
    $('#fullscreenBtn').addEventListener('click',async()=>{
      try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch {}
    });
    window.addEventListener('online',()=>resumeAfterPause());
    window.addEventListener('offline',()=>{ stopPolling(); setLive('error','Sem rede'); });
    document.addEventListener('visibilitychange',()=>{
      if (document.hidden && state.meta?.pause_when_hidden) { stopPolling(); setLive('paused','Pausado'); }
      else resumeAfterPause();
    });
    setupSearch();
  }

  async function boot() {
    setupEvents();
    updateRoundUi();
    // A cartografia local abre mesmo se o TSE estiver temporariamente indisponível.
    try { await initBrazil(); } catch(e) { console.warn('Falha ao carregar cartografia local',e); }
    try {
      await loadMeta();
      await loadStates();
      await loadNational();
      startPolling();
    } catch(e) {
      $('#detailPanel').innerHTML = errorHtml(e.message);
      setOverlay('Brasil','Sem conexão com a fonte oficial no momento',null,'—');
      setLive('error','Falha');
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }

  boot();
})();
