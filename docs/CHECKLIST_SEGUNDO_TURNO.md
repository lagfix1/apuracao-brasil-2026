# Checklist — 2º turno 2026 · v0.3

## Alguns dias antes

- [ ] Extrair a v0.3 em uma pasta nova.
- [ ] Rodar `./start.sh` e abrir `Teste 1º turno`.
- [ ] Confirmar Brasil, uma UF, uma cidade e Exterior.
- [ ] Testar PC/celular pela rede local.
- [ ] Testar o Quick Tunnel com `./publicar_cloudflare.sh` ou `./iniciar_publico.sh`.
- [ ] Abrir `/api/health` e confirmar que os contadores de cache aparecem.
- [ ] Voltar o painel para `2º turno`.

## No Android / Termux

- [ ] Executar `termux-wake-lock`.
- [ ] Desativar otimização de bateria do Termux.
- [ ] Manter o telefone carregando se for ficar horas ligado.
- [ ] Evitar deixar várias abas abertas sem necessidade; abas ocultas já pausam sozinhas na v0.3.

## No dia

- [ ] Ligar o servidor com antecedência.
- [ ] Confirmar `2º turno`.
- [ ] Confirmar que `/api/health` responde.
- [ ] Publicar o túnel e testar a URL em 4G/5G.
- [ ] Enquanto o TSE ainda não publicar os arquivos, “Aguardando publicação do TSE” é esperado.
- [ ] Após o início, conferir horário de geração e percentual de seções.
- [ ] Se houver falha temporária do TSE, o painel pode manter o último dado oficial salvo.

## Monitoramento de tráfego/cache

Acesse `http://127.0.0.1:8088/api/health`.

- `network_requests`: consultas externas efetivamente feitas pelo servidor.
- `memory_hits` / `disk_hits`: respostas reaproveitadas do cache.
- `singleflight_waits`: pedidos simultâneos que compartilharam a mesma consulta.
- `derived_cache.hits`: reaproveitamento do mapa de UFs ou da soma por país.

Com vários visitantes, é normal os `hits` subirem muito mais rápido do que `network_requests`. Esse é o comportamento desejado.

## Se algo não carregar

1. Verifique `http://127.0.0.1:8088/api/health`.
2. Teste `https://resultados.tse.jus.br` no navegador do telefone servidor.
3. Veja `tail -50 servidor.log` se estiver usando `iniciar_publico.sh`.
4. Não apague a pasta `cache` durante a apuração.
5. Se o Quick Tunnel cair, inicie outro; a URL aleatória mudará.
