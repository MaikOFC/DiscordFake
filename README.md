# NexusVoice

App leve de texto, voz, câmera e tela para um grupo de amigos, no estilo do
Discord. Roda no Windows como app de desktop (Tauri) e também no navegador.

- Servidor: Fastify, Socket.IO e SQLite (`apps/server`)
- Cliente: React, Vite, Tailwind e Zustand (`apps/client`)
- Voz e vídeo: LiveKit
- App de desktop: Tauri 2 (`apps/client/src-tauri`)

## Rodar em desenvolvimento

```powershell
npm install
copy .env.example .env
```

Baixe o `livekit-server.exe` da [página de releases do LiveKit](https://github.com/livekit/livekit/releases)
e coloque em `tools/livekit/`. Depois, em dois terminais:

```powershell
npm run livekit
```

```powershell
npm run dev
```

Abra `http://localhost:5173`, crie uma conta e um servidor.

## App de desktop

```powershell
npm run tauri:dev
```

```powershell
npm run tauri:build
```

O `tauri:build` gera o instalador em
`apps/client/src-tauri/target/release/bundle/nsis/`.

Para compilar é preciso do [Rust](https://rustup.rs/) e de um linker de C++.
O caminho oficial é o Visual Studio Build Tools com "Desenvolvimento para
desktop com C++". Sem Visual Studio, também funciona com o
[llvm-mingw](https://github.com/mstorsjo/llvm-mingw) e o alvo
`x86_64-pc-windows-gnullvm` do Rust, apontando o linker no
`config.toml` do Cargo:

```toml
[target.x86_64-pc-windows-gnullvm]
linker = "C:/caminho/llvm-mingw/bin/x86_64-w64-mingw32-clang.exe"
```

Quem só quer usar o app não precisa de nada disso: basta o instalador.

## Hospedar para os amigos

Veja [docs/HOSPEDAGEM.md](docs/HOSPEDAGEM.md). Em resumo: todo mundo no
Radmin VPN, quem hospeda roda `npm run hospedar` e os amigos colocam o IP do
Radmin dessa pessoa na tela de login do app.

## Comandos úteis

| Comando | O que faz |
|---|---|
| `npm run typecheck` | Confere os tipos de todos os pacotes |
| `npm run format` | Formata o código com o Prettier |
| `npm run format:check` | Só confere a formatação (é o que o GitHub roda) |
| `npm run hospedar` | Sobe LiveKit e servidor para a rede do Radmin |
| `npm run firewall` | Libera as portas no firewall só para o Radmin |

A cada pull request, o GitHub roda o typecheck, a formatação, o build do
cliente e a compilação do app de desktop (`.github/workflows/ci.yml`).
Criar uma tag `v0.2.0`, por exemplo, gera o instalador e publica numa
release (`.github/workflows/release.yml`). O app avisa quando sai versão nova.
