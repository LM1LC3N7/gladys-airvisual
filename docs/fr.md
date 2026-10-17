# AirVisual

**Connecteur non officiel, sans lien avec IQAir.** Il amène dans Gladys la
qualité de l'air de vos maisons et des villes de votre choix, lue par l'API
officielle [IQAir AirVisual](https://www.iqair.com/air-pollution-data-api),
et les valeurs de vos moniteurs **AirVisual Pro**, lues par leur lien cloud.

> **Cette intégration n'a jamais été testée avec une vraie clé d'API ni avec
> un vrai AirVisual Pro.** Elle suit la documentation officielle de l'API et
> pyairvisual, le client Python qu'utilise Home Assistant. Merci de signaler
> ce que vous constatez sur le forum de Gladys.

## Ce que vous obtenez

| Appareil dans Gladys                    | Capteurs                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **AirVisual _maison_** (une par maison) | AQI US, AQI Chine, polluant principal (US), polluant principal (Chine), de la ville la plus proche |
| **AirVisual _ville_**                   | les mêmes valeurs pour une ville que vous avez saisie                                              |
| **_nom_ (AirVisual Pro)**               | AQI US et Chine (quand le moniteur les envoie), PM2.5, PM10, CO2, température, humidité            |

- AQI : fonctionnalités `airquality-sensor` (unité « AQI ») ; polluant
  principal : un texte (PM2.5, PM10, O3, NO2, SO2, CO) ; PM2.5 et PM10 en
  µg/m³, CO2 en ppm, température en °C, humidité en %.
- AirVisual met une ville à jour environ une fois par heure ; une valeur de
  plus de 3 heures (1 heure pour un moniteur) n'est pas envoyée à Gladys
  comme valeur actuelle.
- Les noms des appareils et des capteurs sont en anglais ; renommez-les à la
  création si vous le souhaitez.

## Installation

1. Sur le [tableau de bord IQAir](https://dashboard.iqair.com/personal/api-keys),
   créez une clé d'API gratuite **Community**.
2. Installez l'intégration depuis le catalogue de Gladys (Gladys 5.1 ou plus
   récent) et acceptez l'accès à la **position de vos maisons** (pour trouver
   la ville la plus proche de chaque maison).
3. Dans l'écran **Configuration**, collez la clé et enregistrez. En option,
   ajoutez des villes et des identifiants d'AirVisual Pro (voir plus bas).
4. Cliquez sur **Tester AirVisual** : le message liste les lieux et leurs
   dernières valeurs.
5. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus. Leurs
   valeurs arrivent dès leur création.

## Configuration

- **Clé d'API** : gardée par Gladys dans sa base (en clair, comme tout champ
  secret de Gladys), jamais réaffichée dans l'écran de configuration, jamais
  écrite dans les journaux, et envoyée seulement à `api.airvisual.com`.
- **Qualité de l'air des maisons** (activée par défaut) : un lieu par maison
  qui a une position dans Gladys (Paramètres → Maisons). La position,
  arrondie à 2 décimales (1 km environ), est envoyée à AirVisual, qui répond
  avec sa ville la plus proche. Les positions ne sont relues qu'au démarrage
  de l'intégration, à sa reconnexion à Gladys ou à l'enregistrement de sa
  configuration ; la ville la plus proche selon AirVisual peut changer avec
  le temps (une station ferme, une autre ouvre) sous le même appareil Gladys.
- **Villes** : écrites comme AirVisual les écrit, `Ville, Région, Pays`,
  séparées par `;`, par exemple
  `Paris, Ile-de-France, France; Lyon, Auvergne-Rhone-Alpes, France`. Une
  mauvaise orthographe donne « introuvable » dans l'état (et n'est réessayée
  que toutes les 6 heures) ; l'orthographe est celle d'iqair.com : en
  anglais, le plus souvent sans accents. **Cinq lieux au maximum**, maisons
  comprises.
- **Intervalle de lecture de chaque lieu** (30 minutes par défaut, de 10 à
  360).
- **Identifiants des AirVisual Pro** : sur le tableau de bord IQAir, ouvrez
  le moniteur et copiez l'identifiant de son lien d'API (ou le lien entier,
  `https://device.iqair.com/v2/...` ou
  `https://www.airvisual.com/api/v2/node/...` ; aucune autre adresse n'est
  acceptée). Séparez-en plusieurs par des virgules, cinq au maximum.
  L'identifiant donne accès aux valeurs du moniteur : c'est un champ secret,
  jamais réaffiché, saisissez donc la liste entière pour la changer. Dans
  Gladys, un moniteur est connu par une empreinte de son identifiant, jamais
  par l'identifiant lui-même. La clé d'API n'est pas envoyée aux liens des
  moniteurs (pyairvisual l'envoie ; qu'un lien en ait besoin n'est pas encore
  vérifié) : si un lien refuse l'appel, l'état indique « lien refusé ».
- **Intervalle de lecture des AirVisual Pro** (10 minutes par défaut, de 5 à
  60).

## Limites d'usage (plan gratuit « Community »)

Le plan gratuit permet **10 000 appels par mois**, 500 par jour et environ 5
par minute. L'intégration reste en dessous, quelle que soit la
configuration :

- un appel par lieu à chaque intervalle ; un démarrage du conteneur lit
  chaque lieu une fois (une reconnexion à Gladys, non) ; un appel par clic sur
  le bouton de test (il ne lit que le premier lieu et affiche les dernières
  valeurs des autres) ;
- jamais deux appels à moins de 13 secondes d'écart (4,6 par minute au
  plus) ;
- au plus **290 appels par jour UTC** (8 990 par mois), comptés dans un
  fichier sous `/data` pour qu'un redémarrage ne les remette pas à zéro ; les
  lectures périodiques s'arrêtent à 270 et en gardent 20 pour le bouton de
  test. Au-delà, les lectures reprennent après minuit UTC ;
- l'intervalle est relevé de lui-même si les lieux ne tiennent pas : cinq
  lieux sont lus toutes les 28 minutes au moins ;
- une lecture en échec (réseau, erreur du serveur) est réessayée à
  l'intervalle habituel, jamais plus tôt ; une ville introuvable ou aucune
  ville à proximité, toutes les 6 heures.

| Lieux | Intervalle par défaut | Appels par jour | Appels par mois |
| ----- | --------------------- | --------------- | --------------- |
| 1     | 30 min                | 48              | 1 490 environ   |
| 3     | 30 min                | 144             | 4 460 environ   |
| 5     | 30 min                | 240             | 7 440 environ   |

Quand AirVisual répond **429** (« call limit reached » ou « too many
requests »), tous les appels avec la clé s'arrêtent, bouton de test compris :
le délai `Retry-After` si AirVisual en donne un, sinon 1 minute pour « too
many requests » et 1 heure, puis le double à chaque fois, pour « call limit
reached » ; toujours entre 1 minute et 6 heures.

Quand AirVisual **refuse la clé** (erronée, expirée, sans accès), les
lectures avec la clé s'arrêtent et l'état le dit ; un nouvel essai toutes les
6 heures (le bouton de test peut essayer tout de suite), jusqu'à ce que vous
changiez la clé. Dès qu'un appel réussit de nouveau, les autres lieux sont
lus aussitôt. Les AirVisual Pro continuent d'être lus.

La pause, le refus et l'écart de 13 secondes survivent à une reconnexion à
Gladys et à un redémarrage du conteneur (gardés dans le même fichier sous
`/data`, avec une empreinte de la clé, jamais la clé elle-même) ; une
nouvelle clé repart de zéro. Un fichier illisible est compté comme la moitié
du budget du jour consommée.

Les liens des AirVisual Pro sont lus sans la clé d'API, à leur propre
intervalle, un appel à la fois, à 2 secondes d'écart ; une redirection n'est
suivie que vers les deux adresses AirVisual ci-dessus, en HTTPS.

## Dépannage

- **« AirVisual a refusé la clé d'API »** : vérifiez la clé sur le tableau de
  bord IQAir ; une clé Community expire au bout d'un an et se renouvelle là.
- **« introuvable »** à côté d'une ville : vérifiez son orthographe (ville,
  région, pays, comme sur iqair.com : en anglais, le plus souvent sans
  accents).
- **« lien refusé »** à côté d'un moniteur : vérifiez son identifiant sur le
  tableau de bord IQAir.
- **« aucune ville à proximité »** : AirVisual n'a pas de ville assez proche
  de la position de la maison ; saisissez une ville à la place.
- **« Le budget d'appels du jour du plan gratuit est épuisé »** : un autre
  outil utilise peut-être la même clé ; les lectures reprennent après minuit
  UTC.
- Journaux : le niveau se règle avec la variable `LOG_LEVEL`.

## Vie privée

Les positions des maisons (arrondies à 1 km environ) et les villes saisies
sont envoyées à AirVisual (IQAir) pour lire leur qualité de l'air. La clé ne
part que vers `api.airvisual.com`, les identifiants des moniteurs que vers
les deux adresses AirVisual ci-dessus, en HTTPS.

## Crédits

Construit d'après la documentation officielle de l'API AirVisual et
[pyairvisual](https://github.com/bachya/pyairvisual) (MIT, Aaron Bach), le
client Python des intégrations AirVisual de Home Assistant : points d'accès,
messages d'erreur, réponses des moniteurs. Sa notice est dans
`THIRD_PARTY_NOTICES.md`. AirVisual et IQAir sont des marques de leur
propriétaire ; ce connecteur est gratuit et non officiel.
