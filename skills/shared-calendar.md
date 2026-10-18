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

### RÈGLE ABSOLUE — tout rendez-vous daté va au calendrier

- Dès que l'utilisateur mentionne un événement daté — rendez-vous (médecin,
  dentiste, garage…), réunion, anniversaire, échéance, livraison… — crée
  l'événement au calendrier partagé, **même s'il ne dit pas « calendrier »** et
  même s'il ne demande rien explicitement. C'est le comportement par défaut,
  pas une option.
- **Un cron ou un rappel ne remplace JAMAIS l'événement calendrier.** Un cron
  peut s'y ajouter en complément (ex. rappel la veille), mais un rendez-vous
  enregistré seulement en cron est un échec : l'utilisateur ne le verra jamais
  dans l'onglet Calendrier.
- Dates relatives : résous-les en date absolue `AAAA-MM-JJ` avant l'ajout
  (« mercredi prochain », « la semaine des 4 jeudis ») et vérifie le jour de
  la semaine calculé. Heure inconnue → crée l'événement « journée entière »
  plutôt que de t'abstenir. Date ambiguë → demande-la, puis crée l'événement.
  Ne jamais terminer le tour sans événement créé.
- Vérifie après l'ajout : note l'id `evt_…` renvoyé et confirme avec
  `list --q` que l'événement existe avant de dire « c'est enregistré ».
- Jamais de doublon : vérifie avec `list --q` avant d'ajouter un titre
  similaire au même jour.
- Cite l'id `evt_…` renvoyé si l'utilisateur veut corriger ensuite.
- La page dashboard (onglet Calendrier) reste la source de vérité visuelle ;
  ne décris pas les événements de mémoire, relance `list`.
- Aucun secret ne transite par le calendrier.

### Exemple

« J'ai rendez-vous au médecin mercredi prochain » → calcule la date absolue,
puis :

```sh
ob-plugin-shared-calendar-cal add --titre "Rendez-vous médecin" \
  --date AAAA-MM-JJ --source manuel --par agent
```

Confirme avec l'id `evt_…`. Un cron de rappel est facultatif **en plus** —
jamais à la place.
