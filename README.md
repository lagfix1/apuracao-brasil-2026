# Apuração Brasil 2026 — v0.4.0 "Modo Apuração"

Painel web responsivo para acompanhar os arquivos oficiais de resultados publicados pelo Tribunal Superior Eleitoral (TSE). Funciona em celular, tablet, computador e TV com navegador moderno.

> Projeto independente, sem vínculo com o TSE. O painel apenas lê e apresenta os arquivos oficiais disponibilizados em `resultados.tse.jus.br`.

## Novidades da v0.4.0

- **Fotos dos candidatos** carregadas diretamente dos arquivos oficiais do TSE.
- **Brasil geral** permanece visível em um resumo superior mesmo quando você abre um estado, cidade ou país.
- O mapa do Brasil mostra a **porcentagem de seções totalizadas em cada UF**.
- Novo filtro rápido de **capitais**, além da pesquisa livre por cidade/estado/país.
- Projeto preparado para o **Railway**, usando a porta `PORT` fornecida automaticamente pela plataforma.
- Mantém todo o modo econômico da v0.3: cache central, single-flight, ETag/gzip e atualização sob demanda.

## Novidades da v0.3.0

Esta versão foi otimizada para ficar aberta durante a apuração sem gerar tráfego desnecessário no Wi-Fi do servidor:

- **Cache central no servidor**: todos os celulares/PCs compartilham o mesmo cache dos arquivos do TSE.
- **Single-flight**: se vários usuários pedirem o mesmo arquivo simultaneamente, apenas uma consulta externa é feita.
- **ETag / 304**: quando um resultado não mudou, o navegador não baixa novamente todo o JSON.
- **Gzip** nas respostas JSON maiores.
- Brasil/resultado atualiza rapidamente; o mapa completo das 27 UFs usa uma cadência bem menor.
- Estado/cidade só é consultado quando está sendo visualizado.
- País do exterior é agregado **sob demanda** e atualiza em cadência mais lenta, pois pode envolver várias cidades.
- A aba em segundo plano **para de consultar** e atualiza ao voltar para a tela.
- O mapa-múndi só é carregado quando o usuário abre **Exterior**.
- Service Worker v0.3 não baixa cartografia mundial antecipadamente.
- Mantém ordenação por **Mais votados** como padrão, com filtros A–Z e Número.

## Cadências padrão

- Brasil / Presidência: **15 s**
- Estado ou cidade selecionada: **20 s**
- Exterior total: **30 s**
- País selecionado: **60 s**
- Atualização visual do conjunto das 27 UFs: **120 s**
- Cache de arquivo individual do TSE: **10 s**
- Cache do mapa de UFs: **90 s**
- Cache da soma por país: **45 s**

Esses valores podem ser alterados em `config.json`.

## Hospedar no Railway

O projeto já inclui `railway.json` e `Procfile`.

1. Entre no Railway e escolha **New Project → Deploy from GitHub repo**.
2. Selecione `lagfix1/apuracao-brasil-2026`.
3. Aguarde o deploy.
4. No serviço, abra **Settings → Networking → Generate Domain**.
5. Use o endereço HTTPS gerado pelo Railway.

O servidor lê automaticamente a variável `PORT` do Railway e continua escutando em `0.0.0.0`.

> Como o painel precisa consultar `resultados.tse.jus.br`, o Railway precisa permitir acesso externo de saída. No Trial, conecte/verifique a conta pelo GitHub para tentar obter o Full Trial.

## Windows

1. Extraia o ZIP.
2. Dê dois cliques em `start.bat`.
3. Abra `http://127.0.0.1:8088`.

Na mesma rede, use o IP mostrado no terminal, por exemplo `http://192.168.10.237:8088`.

Requisito: Python 3. Não é necessário Flask, Node, npm ou banco de dados.

## Instalar direto do GitHub

No Termux, depois de instalar o Git uma vez:

```bash
pkg install git -y
cd ~
git clone https://github.com/lagfix1/apuracao-brasil-2026.git
cd apuracao-brasil-2026
chmod +x *.sh
./iniciar_publico.sh
```

Para atualizar depois:

```bash
cd ~/apuracao-brasil-2026
git pull
```

## Android / Termux — servidor do Achados do Sul

```bash
pkg install python -y
chmod +x start.sh publicar_cloudflare.sh
./start.sh
```

O servidor escuta em `0.0.0.0:8088`. Para não deixar o Android suspender o Termux durante o teste:

```bash
termux-wake-lock
```

Também deixe o Termux sem otimização de bateria nas configurações do Android.

## Publicar pela Cloudflare sem pagar

Em outra sessão do Termux:

```bash
pkg install cloudflared -y
./publicar_cloudflare.sh
```

O Quick Tunnel mostrará um endereço `https://...trycloudflare.com`. Ele é temporário e muda se o processo for encerrado/recriado.

Para iniciar **servidor + wake lock + Cloudflare** com um único comando no Termux:

```bash
chmod +x iniciar_publico.sh
./iniciar_publico.sh
```

O servidor fica em segundo plano (`servidor.log`) e o `cloudflared` permanece na tela mostrando a URL pública.

## Teste antes do 2º turno

O painel inicia em **2º turno**. Enquanto os arquivos ainda não existirem, mostrará “Aguardando publicação do TSE”. Use **Teste 1º turno** para validar o sistema com dados oficiais já encerrados.

## Monitorar o cache

Abra:

```text
http://IP_DO_SERVIDOR:8088/api/health
```

A resposta inclui contadores de `network_requests`, `memory_hits`, `disk_hits`, `singleflight_waits` e cache derivado. Isso ajuda a confirmar que vários usuários estão reaproveitando o mesmo download do TSE.

## Configuração

```json
{
  "host": "0.0.0.0",
  "port": 8088,
  "default_round": 2,
  "poll_seconds": 15,
  "selection_poll_seconds": 20,
  "exterior_poll_seconds": 30,
  "country_poll_seconds": 60,
  "states_poll_seconds": 120,
  "cache_seconds": 10,
  "states_cache_seconds": 90,
  "country_cache_seconds": 45,
  "pause_when_hidden": true,
  "enable_test_mode": true
}
```

## Fonte oficial

- https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados
- https://resultados.tse.jus.br
- https://resultados.tse.jus.br/oficial/comum/config/ele-c.json

## Estrutura

```text
apuracao_brasil_2026_v0.3.0/
├── server.py
├── config.json
├── start.bat
├── start.sh
├── publicar_cloudflare.bat
├── publicar_cloudflare.sh
├── iniciar_publico.sh
├── publicar_tailscale.bat
├── publicar_tailscale.sh
├── cache/
├── docs/
└── static/
```
