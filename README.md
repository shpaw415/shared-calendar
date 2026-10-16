# shared-calendar

Calendrier partagé open-bot : un magasin d'événements central que les autres
plugins (price-scout, fb-message-guardian, cron jobs…) alimentent, et une page
dashboard pour l'utilisateur.

- **Page dashboard** (onglet « Calendrier ») : calendrier mensuel, liste
  d'événements avec filtres (dates, source, recherche), création/édition/
  suppression en un clic.
- **API REST** du serveur de page : `GET/POST api/events`, `PUT/DELETE
  api/events/<id>`, `GET api/sources` (filtres `from`, `to`, `source`, `q`).
- **CLI inter-plugins** : `ob-plugin-shared-calendar-cal` (`add`, `list`,
  `show`, `update`, `delete`, `sources`) — même fichier de données, verrou
  partagé, sortie JSON.
- **Stockage** : `~/.open-bot/pages-data/shared-calendar/events.json`
  (survit aux mises à jour du bureau).

## Dév

- `tools/cal.py` : source du CLI (inliné dans le manifest par `build_manifest.py`).
- `server/server.js` + `server/index.html` : serveur de page dashboard (Bun) —
  déclarés dans `files[]`, servis par le control plane.
- Après toute modification : `python3 build_manifest.py && ob-plugin validate
  ~/plugins-create/shared-calendar && ob-plugin install --path
  ~/plugins-create/shared-calendar`.

Publication marketplace réservée au propriétaire du desktop.
