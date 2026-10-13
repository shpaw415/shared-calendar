#!/usr/bin/env python3
"""ob-plugin-shared-calendar-cal — CLI du calendrier partagé (plugin shared-calendar).

Contrat inter-plugins : tout plugin, cron job ou agent peut ajouter, lister,
modifier et supprimer des événements du calendrier partagé sans HTTP.
Sortie : toujours JSON (ok:true/false). Stockage : fichier JSON unique avec
verrou O_EXCL, partagé avec le serveur de la page dashboard.

Exemples :
  ... add --titre "Suivre devis" --debut "2026-10-20 14:00" --fin "2026-10-20 15:00" --source price-scout
  ... add --titre "Marché" --date 2026-10-25 --source manuel           # journée entière
  ... list --du 2026-10-01 --au 2026-10-31 --source price-scout --json
  ... update evt_xxx --titre "Nouveau titre" --debut "2026-10-21 09:00"
  ... delete evt_xxx
  ... sources
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime

PLUGIN_ID = "shared-calendar"
DATA_DIR = os.path.expanduser("~/.open-bot/pages-data/" + PLUGIN_ID)
DATA_FILE = os.path.join(DATA_DIR, "events.json")
LOCK_FILE = os.path.join(DATA_DIR, "events.lock")
LOCK_STALE_S = 10      # un verrou plus vieux que ça est considéré mort
LOCK_RETRY_S = 5.0     # délai max d'attente du verrou

COULEURS = {
    "manuel": "#6366f1",
    "fb-message-guardian": "#3b82f6",
    "price-scout": "#22c55e",
    "prompt-shield": "#f59e0b",
}
PALETTE = ["#6366f1", "#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#eab308", "#a855f7"]

RE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RE_TIME = re.compile(r"^\d{2}:\d{2}$")


def out(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(code)


# ---------- verrou ----------
class Lock:
    def __enter__(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        deadline = time.time() + LOCK_RETRY_S
        while True:
            try:
                fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode())
                os.close(fd)
                return self
            except FileExistsError:
                try:
                    if time.time() - os.path.getmtime(LOCK_FILE) > LOCK_STALE_S:
                        os.unlink(LOCK_FILE)  # verrou mort (crash), on le retire
                        continue
                except FileNotFoundError:
                    continue
                if time.time() > deadline:
                    out({"ok": False, "erreur": "calendrier occupé (verrou > %ds)" % LOCK_RETRY_S}, 3)
                time.sleep(0.05)

    def __exit__(self, *a):
        try:
            os.unlink(LOCK_FILE)
        except FileNotFoundError:
            pass


def load():
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            d = json.load(f)
    except Exception:
        d = {}
    d.setdefault("events", [])
    return d


def save(d):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, DATA_FILE)


# ---------- validation ----------
def couleur_source(source):
    if source in COULEURS:
        return COULEURS[source]
    h = sum(ord(c) for c in source)
    return PALETTE[h % len(PALETTE)]


def parse_datetime(s):
    """'YYYY-MM-DD HH:MM' | 'YYYY-MM-DDTHH:MM' | 'YYYY-MM-DD' -> (date, heure|None)."""
    s = (s or "").strip().replace("T", " ")
    if RE_DATE.match(s):
        return s, None
    m = re.match(r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$", s)
    if not m:
        raise ValueError("date invalide : %r (attendu AAAA-MM-JJ[ HH:MM])" % s)
    datetime.strptime(m.group(1), "%Y-%m-%d")
    datetime.strptime(m.group(2), "%H:%M")
    return m.group(1), m.group(2)


def check_fields(e):
    if not e.get("titre") or not str(e["titre"]).strip():
        raise ValueError("titre requis")
    if len(str(e["titre"])) > 200:
        raise ValueError("titre trop long (200 max)")
    if len(e.get("desc") or "") > 2000:
        raise ValueError("description trop longue (2000 max)")
    for k in ("d1", "d2"):
        if not RE_DATE.match(e.get(k) or ""):
            raise ValueError("%s doit être une date AAAA-MM-JJ" % k)
        datetime.strptime(e[k], "%Y-%m-%d")
    for k in ("h1", "h2"):
        if e.get(k) and not RE_TIME.match(e[k]):
            raise ValueError("%s doit être une heure HH:MM" % k)
    debut = e["d1"] + "T" + (e.get("h1") or "00:00")
    fin = e["d2"] + "T" + (e.get("h2") or "23:59")
    if fin < debut:
        raise ValueError("la fin doit être après ou égale au début")
    if not e.get("allDay"):
        e["allDay"] = False
    if not e.get("source"):
        e["source"] = "manuel"
    if len(e["source"]) > 40:
        raise ValueError("source trop longue (40 max)")
    if not e.get("couleur"):
        e["couleur"] = couleur_source(e["source"])
    if not re.match(r"^#[0-9a-fA-F]{6}$", e["couleur"] or ""):
        raise ValueError("couleur doit être #rrggbb")
    return e


def new_id():
    return "evt_%s_%s" % (format(int(time.time() * 1000), "x"), os.urandom(2).hex())


# ---------- commandes ----------
def cmd_add(a):
    if not a.titre:
        out({"ok": False, "erreur": "--titre requis"}, 2)
    if a.date:
        d1, h1 = a.date, None
    elif a.debut:
        d1, h1 = parse_datetime(a.debut)
    else:
        out({"ok": False, "erreur": "--debut 'AAAA-MM-JJ HH:MM' ou --date AAAA-MM-JJ requis"}, 2)
    if a.fin:
        d2, h2 = parse_datetime(a.fin)
    else:
        d2, h2 = (d1, None) if h1 is None else (d1, h1)
    all_day = bool(a.journee) or h1 is None
    if h1 is None and a.debut and not a.journee:
        all_day = True  # date seule = journée entière
    ev = {
        "id": new_id(),
        "titre": a.titre.strip(),
        "desc": (a.desc or "").strip(),
        "d1": d1, "h1": None if all_day else (h1 or "09:00"),
        "d2": d2, "h2": None if all_day else (h2 or "10:00"),
        "allDay": all_day,
        "source": (a.source or "manuel").strip(),
        "couleur": a.couleur,
        "created_by": a.par or "manuel",
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "updated_at": None,
    }
    with Lock():
        d = load()
        check_fields(ev)
        d["events"].append(ev)
        save(d)
    out({"ok": True, "event": ev})


def cmd_list(a):
    with Lock():
        d = load()
    evs = d["events"]
    if a.du:
        evs = [e for e in evs if (e["d2"] + "T" + (e.get("h2") or "23:59")) >= a.du + "T00:00"]
    if a.au:
        evs = [e for e in evs if (e["d1"] + "T" + (e.get("h1") or "00:00")) <= a.au + "T23:59"]
    if a.source:
        evs = [e for e in evs if e.get("source") == a.source]
    if a.q:
        q = a.q.lower()
        evs = [e for e in evs if q in (e.get("titre", "") + " " + (e.get("desc") or "")).lower()]
    evs = sorted(evs, key=lambda e: (e["d1"] + "T" + (e.get("h1") or "00:00"), e["id"]))
    out({"ok": True, "count": len(evs), "events": evs})


def find_or_die(d, id_):
    for e in d["events"]:
        if e["id"] == id_:
            return e
    out({"ok": False, "erreur": "événement introuvable : " + id_}, 4)


def cmd_show(a):
    with Lock():
        d = load()
    out({"ok": True, "event": find_or_die(d, a.id)})


def cmd_update(a):
    with Lock():
        d = load()
        ev = find_or_die(d, a.id)
        cur = dict(ev)
        try:
            if a.titre is not None:
                cur["titre"] = a.titre.strip()
            if a.desc is not None:
                cur["desc"] = a.desc.strip()
            if a.debut:
                d1, h1 = parse_datetime(a.debut)
                cur["d1"] = d1
                if h1:
                    cur["h1"] = h1
                    cur["allDay"] = False if not a.journee else True
            if a.fin:
                d2, h2 = parse_datetime(a.fin)
                cur["d2"] = d2
                if h2:
                    cur["h2"] = h2
                    cur["allDay"] = False if not a.journee else True
            if a.journee is True:
                cur["allDay"] = True
                cur["h1"] = cur["h2"] = None
            elif a.journee is False:
                cur["allDay"] = False
                cur["h1"] = cur.get("h1") or "09:00"
                cur["h2"] = cur.get("h2") or "10:00"
            if a.source is not None:
                cur["source"] = a.source.strip()
            if a.couleur is not None:
                cur["couleur"] = a.couleur
            check_fields(cur)
        except ValueError as ex:
            out({"ok": False, "erreur": str(ex)}, 2)
        cur["updated_at"] = datetime.now().isoformat(timespec="seconds")
        d["events"][d["events"].index(ev)] = cur
        save(d)
    out({"ok": True, "event": cur})


def cmd_delete(a):
    with Lock():
        d = load()
        ev = find_or_die(d, a.id)
        d["events"].remove(ev)
        save(d)
    out({"ok": True, "deleted": ev})


def cmd_sources(a):
    with Lock():
        d = load()
    seen = dict(COULEURS)
    for e in d["events"]:
        seen.setdefault(e.get("source") or "manuel", e.get("couleur") or couleur_source(e.get("source") or "manuel"))
    out({"ok": True, "sources": [{"id": k, "couleur": v} for k, v in sorted(seen.items())]})


def main():
    ap = argparse.ArgumentParser(prog="ob-plugin-shared-calendar-cal", description="Calendrier partagé open-bot")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add", help="ajouter un événement")
    p.add_argument("--titre", required=True)
    p.add_argument("--desc", default="")
    p.add_argument("--debut", help="'AAAA-MM-JJ HH:MM' ou 'AAAA-MM-JJ' (date seule = journée entière)")
    p.add_argument("--date", help="raccourci journée entière : AAAA-MM-JJ")
    p.add_argument("--fin", help="'AAAA-MM-JJ HH:MM' ou 'AAAA-MM-JJ' (défaut : même créneau/jour)")
    p.add_argument("--journee", action="store_true", help="forcer journée entière")
    p.add_argument("--source", default="manuel", help="plugin ou 'manuel' (défaut)")
    p.add_argument("--couleur", help="#rrggbb (défaut : couleur de la source)")
    p.add_argument("--par", help="créateur : plugin:price-scout, cron:xxx, agent, manuel")
    p.set_defaults(fn=cmd_add)

    p = sub.add_parser("list", help="lister/filtrer")
    p.add_argument("--du", help="date AAAA-MM-JJ incluse")
    p.add_argument("--au", help="date AAAA-MM-JJ incluse")
    p.add_argument("--source")
    p.add_argument("--q", help="recherche texte titre+description")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("show", help="détail d'un événement")
    p.add_argument("id")
    p.set_defaults(fn=cmd_show)

    p = sub.add_parser("update", help="modifier un événement")
    p.add_argument("id")
    p.add_argument("--titre")
    p.add_argument("--desc")
    p.add_argument("--debut")
    p.add_argument("--fin")
    p.add_argument("--journee", dest="journee", action="store_true", default=None)
    p.add_argument("--pas-journee", dest="journee", action="store_false")
    p.add_argument("--source")
    p.add_argument("--couleur")
    p.set_defaults(fn=cmd_update)

    p = sub.add_parser("delete", help="supprimer un événement")
    p.add_argument("id")
    p.set_defaults(fn=cmd_delete)

    p = sub.add_parser("sources", help="lister les sources connues et leurs couleurs")
    p.set_defaults(fn=cmd_sources)

    a = ap.parse_args()
    try:
        a.fn(a)
    except ValueError as ex:
        out({"ok": False, "erreur": str(ex)}, 2)


if __name__ == "__main__":
    main()
