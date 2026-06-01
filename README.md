# stock_app

## Install `research-a-share-stock`

This repository publishes the `research-a-share-stock` Codex skill under
`skills/research-a-share-stock`.

### Windows PowerShell

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py" `
  --repo porcorosso0303/stock_app `
  --ref master `
  --path skills/research-a-share-stock
```

### Linux or macOS

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo porcorosso0303/stock_app \
  --ref master \
  --path skills/research-a-share-stock
```

Restart Codex after installation. The installed skill is available as
`$research-a-share-stock`.

### Plain Git Fallback

If the Codex installer script is unavailable, clone this repository and copy
the skill directory into `$CODEX_HOME/skills` (normally `~/.codex/skills`).

```powershell
git clone --depth 1 --branch master https://github.com/porcorosso0303/stock_app.git stock_app-skills
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills"
Copy-Item -Recurse -Force ".\stock_app-skills\skills\research-a-share-stock" "$env:USERPROFILE\.codex\skills\"
```
