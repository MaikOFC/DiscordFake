# Hospedar o NexusVoice pelo Radmin VPN

O Radmin VPN cria uma rede particular entre os PCs do grupo. Com ele, um PC
roda o servidor e os outros entram pelo IP do Radmin desse PC. Não precisa
abrir porta no roteador, nem comprar domínio, nem configurar HTTPS.

O app de desktop é o jeito certo de entrar. Pelo navegador, o microfone e a
câmera só funcionam em `localhost` ou com HTTPS, e o endereço do Radmin não
tem HTTPS. No app essa trava não existe.

## Quem hospeda

1. Instale o [Radmin VPN](https://www.radmin-vpn.com/br/), crie uma rede e
   passe o nome e a senha da rede para os amigos.
2. Tenha o projeto rodando como no README (`npm install`, `.env` e o
   `tools/livekit/livekit-server.exe`).
3. Feche o `npm run dev` e o `npm run livekit`, se estiverem abertos.
4. Rode:

   ```powershell
   npm run hospedar
   ```

   O script descobre o seu IP do Radmin, cria chaves fortes para o LiveKit em
   `.env.hospedagem` (só na primeira vez), abre o LiveKit numa janela e o
   servidor em outra. Ele mostra o endereço que os amigos devem usar.

5. Na primeira vez, libere o firewall:

   ```powershell
   npm run firewall
   ```

   O Windows pede confirmação de administrador. As regras só aceitam
   conexões que vêm do Radmin (`26.x.x.x`); a internet e a rede de casa
   continuam bloqueadas. Para tirar as regras: `npm run firewall -- -Remover`.

6. No seu próprio app, use o servidor `localhost`.

Enquanto o servidor estiver ligado, o PC precisa ficar ligado e conectado ao
Radmin. Para parar, feche as duas janelas.

## Quem entra

1. Instale o Radmin VPN e entre na rede do grupo.
2. Instale o app do NexusVoice.
3. Na tela de login, clique em **Trocar** ao lado de "Servidor" e digite o IP
   do Radmin de quem hospeda (por exemplo `26.49.143.245`). A porta entra
   sozinha. **Testar** confere se o servidor responde.
4. Crie sua conta e entre no servidor com o código de convite.

## Quanto de internet isso usa

Tudo passa pelo PC de quem hospeda. A conta é a quantidade de pessoas
recebendo cada transmissão:

| Situação | Upload aproximado de quem hospeda |
|---|---|
| 5 pessoas só na voz | menos de 1 Mbps |
| 1 tela em 720p30 vista por 4 pessoas | cerca de 8 Mbps |
| 1 tela em 1080p60 vista por 4 pessoas | cerca de 32 Mbps |

Se a tela travar para os outros, use 720p ou 30 FPS no seletor de qualidade.

## Dados e backup

- O banco fica em `apps/server/data/nexusvoice.db`.
- Avatares, banners e anexos ficam em `apps/server/data/uploads`.
- O servidor faz uma cópia do banco a cada 6 horas em
  `apps/server/data/backups` e guarda as 10 últimas.

Os arquivos de `uploads` não entram no backup automático. Para uma cópia
completa, copie a pasta `apps/server/data` inteira com o servidor desligado.

## Problemas comuns

- **"Servidor não encontrado" no app do amigo:** confira se os dois aparecem
  online no Radmin, se o `npm run hospedar` está aberto e se o
  `npm run firewall` foi rodado.
- **Entra no canal de voz mas ninguém se ouve:** quase sempre é a porta UDP
  7882 bloqueada. Rode o `npm run firewall` de novo.
- **O Radmin mostra "relay" em vez de conexão direta:** funciona, mas com mais
  atraso. Reiniciar o Radmin dos dois lados às vezes resolve.

## E depois do Radmin?

Para ninguém precisar do Radmin nem deixar o PC ligado, o NexusVoice também
roda numa máquina grátis da Oracle, com domínio e HTTPS. O passo a passo está
em [SERVIDOR-NA-NUVEM.md](SERVIDOR-NA-NUVEM.md), e ele explica como levar as
contas e o histórico deste servidor para lá.
