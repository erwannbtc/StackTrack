# StackTrack

Suivi de stack Bitcoin — **sats et ₿ uniquement**, données stockées sur l'appareil (localStorage), aucun serveur.

App : https://erwannbtc.github.io/StackTrack/ (PWA : Safari → Partager → « Sur l'écran d'accueil »)

- **Stack** : total, évolution en nominal et en % sur 1M / 3M / 6M / 1A / Tout, accumulation par ère (halving)
- **Historique** : toutes les entrées (DCA, achat ponctuel, reçu, retrait) ; touche une ligne pour la modifier/supprimer
- **Rareté** : combien de personnes peuvent au maximum détenir autant que toi
- **Réseau** : hauteur de bloc, ₿ émis, décompte avant le prochain halving (mempool.space), export/import des données

Chaque entrée peut porter la hauteur de bloc (remplie automatiquement depuis la date) pour être rangée dans la bonne ère.
Sans bloc, l'ère est déduite de la date.

## Données
- Clé localStorage : `stacktrack.v2` → `{ version: 2, entries: [{ id, sats, type, date, block, note }] }`
  (`sats` négatif pour un retrait, `type` ∈ DCA | Ponctuel | Reçu | Retrait, `date` au format AAAA-MM-JJ)
- À la première ouverture, les données de l'ancienne version (clé `transactions`, montants en ₿) sont reprises automatiquement.
- L'import accepte les sauvegardes JSON de la v2 et de l'ancienne version (`{ transactions: [...] }`).
- L'ancienne version reste accessible dans `v1/`.
