#!/usr/bin/env python3
"""Assemble open-bot.plugin.json : inline le CLI (tools/cal.py) et le skill."""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))


def read(p):
    with open(os.path.join(BASE, p), encoding="utf-8") as f:
        return f.read()


manifest = {
    "$schema": "/home/agent/.config/opencode/skills/plugin/open-bot.plugin.schema.json",
    "id": "shared-calendar",
    "name": "Calendrier partagé",
    "version": "0.1.5",
    "description": "Calendrier partagé open-bot : les autres plugins (price-scout, fb-message-guardian…) y ajoutent, modifient et suppriment événements et rendez-vous via un CLI dédié, et l'utilisateur tout voit et édite dans l'onglet Calendrier du dashboard (vue mensuelle + liste filtrable par dates, source et recherche).",
    "author": "shpaw415",
    "repo": "shpaw415/shared-calendar",
    "category": "productivity",
    "tags": [
        "calendrier",
        "evenements",
        "rendez-vous",
        "api",
        "inter-plugins",
    ],
    "tools": [
        {
            "name": "cal",
            "content": read("tools/cal.py"),
        }
    ],
    "files": [
        {"name": "server.ts", "source": "server/server.ts", "exec": True},
        {"name": "index.html", "source": "server/index.html", "exec": False},
        {"name": "app.ts", "source": "server/app.ts", "exec": False},
        {"name": "styles.css", "source": "server/styles.css", "exec": False},
    ],
    "dashboard": {
        "pages": {"entry": "server.ts", "ui": "server/index.html"},
        "tabs": [
            {"id": "calendrier", "title": "Calendrier", "kind": "app"}
        ],
    },
    "skills": [
        {
            "name": "shared-calendar",
            "description": "Ajouter, lister, modifier ou supprimer des événements du calendrier partagé open-bot. OBLIGATOIRE dès que l'utilisateur mentionne un rendez-vous ou un événement daté (médecin, réunion, échéance…), même sans dire « calendrier » — un cron ou un rappel ne remplace jamais l'événement calendrier. Déclencheurs : « j'ai rendez-vous… », une date relative (« mercredi prochain »), « ajoute au calendrier », « qu'est-ce qu'il y a au calendrier », un plugin annonce un rendez-vous, l'onglet Calendrier du dashboard.",
            "body": read("skills/shared-calendar.md"),
        }
    ],
}

out = os.path.join(BASE, "open-bot.plugin.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("manifest écrit :", out, "(%d octets)" % os.path.getsize(out))
