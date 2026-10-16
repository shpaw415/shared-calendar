# shared-calendar

Ajouter, lister, modifier ou supprimer des événements du calendrier partagé
open-bot (rendez-vous, échéances, suivis) — à la demande de l'utilisateur ou
quand un plugin doit y déposer un événement. Déclencheurs : « ajoute au
calendrier », « qu'est-ce qu'il y a au calendrier », un plugin annonce un
rendez-vous/une échéance, l'onglet Calendrier du dashboard.

# Calendrier partagé

Un seul magasin d'événements, partagé par tous les plugins et l'utilisateur.
Tout passe par le CLI `ob-plugin-shared-calendar-cal` (sortie JSON, `ok:true/false`).
L'utilisateur voit et édite tout dans l'onglet **Calendrier** du dashboard.

## Ajouter

```sh
# événement daté avec heures
ob-plugin-shared-calendar-cal add --titre "Suivre devis D Bureau" \
  --debut "2026-10-20 14:00" --fin "2026-10-20 15:00" \
  --source price-scout --par plugin:price-scout

# journée entière (date seule = journée entière)
ob-plugin-shared-calendar-cal add --titre "Marché municipal" --date 2026-10-25 --desc "Kiosque communautaire"
```

- `--source` : nom du plugin à l'origine (`price-scout`, `fb-message-guardian`,
  `prompt-shield`) ou `manuel`. La couleur du badge est automatique.
- `--par` : créateur (`plugin:<id>`, `cron:<job>`, `agent`, `manuel`) — traçabilité.
- `--debut` accepte `AAAA-MM-JJ HH:MM` ou `AAAA-MM-JJ` ; `--fin` facultatif
  (défaut : même heure/jour). Sans heures, l'événement est « journée entière ».

## Consulter

```sh
ob-plugin-shared-calendar-cal list --du 2026-10-01 --au 2026-10-31
ob-plugin-shared-calendar-cal list --source price-scout --q "devis"
ob-plugin-shared-calendar-cal show evt_xxxx
ob-plugin-shared-calendar-cal sources    # sources connues + couleurs
```

## Modifier / supprimer

```sh
ob-plugin-shared-calendar-cal update evt_xxxx --debut "2026-10-21 09:00" --titre "Nouveau titre"
ob-plugin-shared-calendar-cal delete evt_xxxx
```

## Règles

- Ne crée un événement que si l'utilisateur le demande ou si un flux plugin le
  prévoit (ex. price-scout : échéance d'une alerte prix) — jamais de doublon :
  vérifie avec `list --q` avant d'ajouter un titre similaire au même jour.
- Cite l'id `evt_…` renvoyé si l'utilisateur veut corriger ensuite.
- La page dashboard (onglet Calendrier) reste la source de vérité visuelle ;
  ne décris pas les événements de mémoire, relance `list`.
- Aucun secret ne transite par le calendrier.
