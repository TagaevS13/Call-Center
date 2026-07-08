#!/usr/bin/env python3
"""Replace docker compose patterns with native equivalents in scripts and docs."""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCAN_DIRS = [REPO / "scripts", REPO / "ops", REPO / "asterisk" / "etc", REPO / "backups"]
EXTENSIONS = {".py", ".sh", ".md", ".conf", ".txt", ".ps1"}

REPLACEMENTS = [
    (r"docker compose -f \$\{REMOTE\}/docker-compose\.yml exec -T asterisk-a ", ""),
    (r"docker compose -f /opt/call-center/asterisk-cc-phase1/docker-compose\.yml exec -T asterisk-a ", ""),
    (r'docker compose -f \{REMOTE\}/docker-compose\.yml exec -T asterisk-a ', ""),
    (r"docker compose exec -T asterisk-a asterisk -rx ", "asterisk -rx "),
    (r"docker compose exec asterisk-a asterisk -rx ", "asterisk -rx "),
    (r"docker compose exec -T asterisk-a sh -lc ", "sh -lc "),
    (r"docker compose exec -T asterisk-a sh -c ", "sh -c "),
    (r"docker compose exec -T asterisk-a ", ""),
    (r"docker compose exec asterisk-a ", ""),
    (r"docker compose exec -T postgres psql", "psql -h 127.0.0.1 -p 5433 -U postgres"),
    (r"docker compose exec postgres psql", "psql -h 127.0.0.1 -p 5433 -U postgres"),
    (r"docker compose exec -T webui python /app/cc_config_sync.py", "cd /opt/call-center/asterisk-cc-phase1/webui && python3 cc_config_sync.py"),
    (r"docker compose exec -T webui ", "cd /opt/call-center/asterisk-cc-phase1/webui && "),
    (r"docker compose logs asterisk-a", "journalctl -u cc-asterisk"),
    (r"docker compose logs webui", "journalctl -u cc-webui"),
    (r"docker compose restart asterisk-a", "systemctl restart cc-asterisk-prestart cc-asterisk"),
    (r"docker compose up -d --force-recreate asterisk-a webui", "systemctl restart cc-asterisk-prestart cc-asterisk cc-webui"),
    (r"docker compose up -d --force-recreate asterisk-a", "systemctl restart cc-asterisk-prestart cc-asterisk"),
    (r"docker compose up -d asterisk-a webui", "systemctl restart cc-asterisk-prestart cc-asterisk cc-webui"),
    (r"docker compose up -d asterisk-a", "systemctl restart cc-asterisk-prestart cc-asterisk"),
    (r"docker compose ps coturn asterisk-a", "systemctl is-active cc-coturn cc-asterisk"),
    (r"docker compose ps asterisk-a", "systemctl is-active cc-asterisk"),
    (r"docker compose ps", "systemctl is-active cc-asterisk cc-webui postgresql"),
    (r"docker-entrypoint\.sh", "asterisk-prestart.sh"),
    (r"asterisk-a", "cc-asterisk"),
    (r"Docker host network", "native host network"),
    (r"без Docker", "native"),
    (r"Сервисы в \*\*host network\*\* \(Docker\)", "Сервисы в **host network** (native)"),
]

SKIP_NAMES = {"remote-deploy-native.py", "migrate-docker-to-native.py"}


def main() -> None:
    changed = 0
    for base in SCAN_DIRS:
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix not in EXTENSIONS or path.name in SKIP_NAMES:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            new = text
            for pat, repl in REPLACEMENTS:
                new = re.sub(pat, repl, new)
            if new != text:
                path.write_text(new, encoding="utf-8")
                changed += 1
                print(path.relative_to(REPO))
    print(f"Updated {changed} files")


if __name__ == "__main__":
    main()
