# TracName — Briefing complet pour Claude Code

## Contexte : Compétition Intercom Vibe Competition

SebAi participe à la compétition "Intercom Vibe Competition" organisée par Trac-Systems.
- **Récompense :** 500 TNK par app éligible
- **Deadline :** 12 février 2026 à 00:00 UTC
- **Repo compétition :** https://github.com/Trac-Systems/intercom-competition
- **Repo Intercom principal :** https://github.com/Trac-Systems/intercom

SebAi a déjà soumis **TracStamp** (service d'horodatage). TracName est sa **deuxième app**.

---

## Ce qui est DÉJÀ fait (ne pas refaire)

### Environnement installé et fonctionnel
- **OS :** Windows (cmd / Node.js command prompt)
- **Node.js :** v24.13.0 (via nvm4w)
- **npm :** 11.6.2
- **Git :** 2.35.1
- **Pear Runtime :** v2.2.6
- **Intercom :** cloné et installé dans `D:\TracIntercom\intercom`
- **Dépendances :** installées (`npm install` fait, `trac-wallet@1.0.1` override appliqué)

### Identité pour TracName (store "compet2") — DÉJÀ CRÉÉE
- **Adresse Trac :** `trac1vfcs9v234ulchzkwghz67wz3ztl9kuxvp8ck3lpfcgpn2srqm29shg086j`
- **Peer pubkey (hex) :** `627102b151af3f8b8ace45c5af385112fe5b70cc09f168fc29c203354060da8b`
- **Peer Writer key :** `2042a2ffa644ee4b43ae5d032593d6a42d1c4253d5ab17fbb50e986a8bb1a9f4`
- **Store peer :** `stores\compet2`
- **Store MSB :** `stores\compet2-msb`
- **Keypair :** `stores\compet2\db\keypair.json` (chiffré, NE PAS toucher)

### Repo GitHub DÉJÀ créé
- **URL :** `https://github.com/ZotSite/TracName`
- **Cloné localement dans :** `D:\TracIntercom\TracName`
- Le repo est vide (seulement un README par défaut)

### App précédente (TracStamp) — NE PAS TOUCHER
- TracStamp est dans `D:\TracIntercom\intercom\tracstamp\` et `D:\TracIntercom\intercom-fork\`
- Store `compet` et `compet-msb` = TracStamp
- NE JAMAIS modifier ces fichiers ou stores

---

## Ce qu'il faut construire : "TracName"

### Concept
TracName est un **service d'enregistrement et de vérification d'identité** pour les agents (et humains) sur le réseau Intercom. C'est la "coche bleue" du réseau Trac : un annuaire certifié qui associe un **nom unique** à une **clé publique**.

### Problème résolu
Sur Intercom, n'importe quel agent peut prétendre s'appeler "OracleBot". Rien ne l'empêche. Deux agents peuvent utiliser le même nom. Personne ne sait qui est le vrai.

### Solution
TracName est un registre de noms uniques. Premier arrivé, premier servi :
- Un agent veut "OracleBot" → TracName vérifie que le nom est libre → OK, c'est à lui
- Un autre veut "OracleBot" → déjà pris → refusé
- N'importe qui peut vérifier : "à qui appartient OracleBot ?" → TracName répond avec la clé publique

### Point clé : vérification automatique de l'identité
Quand un agent envoie un message sur le sidechannel, le réseau Intercom fournit **automatiquement** sa clé publique dans le champ `from` du message. L'agent ne peut pas tricher. TracName utilise ce `from` pour associer le nom à la bonne clé publique.

### Architecture

```
Intercom (P2P / Pear runtime)
    ↓
SC-Bridge (WebSocket ws://127.0.0.1:49222)
    ↓
TracName bot (script Node.js séparé)
    |
    ├── Écoute le canal "tracname" pour les demandes
    ├── Reçoit les demandes d'enregistrement (register)
    ├── Vérifie que le nom est disponible
    ├── Associe le nom à la clé publique du demandeur (from)
    ├── Stocke les noms localement (fichier JSON)
    ├── Répond aux recherches (lookup) et vérifications (verify)
    ├── S'annonce périodiquement sur "0000intercom"
    └── Fournit des statistiques
```

### Deux processus séparés tournent en parallèle

1. **Intercom** — lancé avec `pear run .` (gère le réseau P2P)
2. **TracName bot** — un script Node.js classique qui se connecte au WebSocket SC-Bridge d'Intercom

Le bot TracName ne fait PAS partie du code Intercom. C'est un fichier séparé qui communique avec Intercom via WebSocket.

---

## Protocole de communication TracName

### Canal utilisé
- **Canal principal :** `tracname` (canal dédié pour les demandes/réponses)
- **Canal d'annonce :** `0000intercom` (pour annoncer la présence du service)

### Messages entrants (ce que les autres agents envoient)

**Enregistrer un nom :**
```json
{
  "type": "register",
  "name": "OracleBot"
}
```
→ TracName lit le `from` du message (clé publique fournie par le réseau) et associe "OracleBot" à cette clé.

**Chercher un nom (qui est derrière ce nom ?) :**
```json
{
  "type": "lookup",
  "name": "OracleBot"
}
```

**Vérifier une clé (quel nom pour cette clé ?) :**
```json
{
  "type": "verify",
  "public_key": "627102b151af3f8b8ace45c5af385112fe5b70cc09f168fc29c203354060da8b"
}
```

**Demande de stats :**
```json
{
  "type": "stats_request"
}
```

### Messages sortants (ce que TracName renvoie)

**Confirmation d'enregistrement :**
```json
{
  "type": "register_response",
  "success": true,
  "name": "OracleBot",
  "public_key": "627102b151af...",
  "registered_at": "2026-02-05T10:00:00.000Z",
  "certificate_id": "TN-00001",
  "message": "Name 'OracleBot' successfully registered"
}
```

**Enregistrement refusé (nom déjà pris) :**
```json
{
  "type": "register_response",
  "success": false,
  "name": "OracleBot",
  "message": "Name 'OracleBot' is already taken",
  "owned_by": "abc123..." 
}
```

**Résultat de recherche (lookup) :**
```json
{
  "type": "lookup_response",
  "found": true,
  "name": "OracleBot",
  "public_key": "627102b151af...",
  "registered_at": "2026-02-05T10:00:00.000Z",
  "certificate_id": "TN-00001"
}
```

**Résultat de vérification (verify) :**
```json
{
  "type": "verify_response",
  "found": true,
  "public_key": "627102b151af...",
  "name": "OracleBot",
  "registered_at": "2026-02-05T10:00:00.000Z",
  "certificate_id": "TN-00001"
}
```

**Statistiques :**
```json
{
  "type": "stats_response",
  "total_names": 42,
  "uptime_seconds": 12345,
  "last_certificate_id": "TN-00042",
  "service": "TracName",
  "version": "1.0.0"
}
```

**Annonce sur 0000intercom (périodique, toutes les 5 minutes) :**
```json
{
  "type": "service_announce",
  "service": "TracName",
  "description": "P2P identity verification service - the blue checkmark of the Trac Network",
  "channel": "tracname",
  "version": "1.0.0",
  "commands": ["register", "lookup", "verify", "stats_request"],
  "total_names": 42
}
```

---

## Règles métier importantes

### Enregistrement
1. Un nom ne peut être enregistré qu'UNE SEULE FOIS (premier arrivé, premier servi)
2. Un nom est insensible à la casse ("OracleBot" = "oraclebot" = "ORACLEBOT")
3. Un nom doit faire entre 3 et 32 caractères
4. Un nom ne peut contenir que lettres, chiffres, tirets et underscores (a-z, 0-9, -, _)
5. Une clé publique peut enregistrer PLUSIEURS noms (comme un humain peut avoir plusieurs pseudos)
6. Le `from` du message (fourni par le réseau) est TOUJOURS utilisé comme clé publique — jamais un champ envoyé par l'agent

### Recherche et vérification
1. Les lookups et verify sont GRATUITS et ouverts à tous
2. Si un nom ou une clé n'est pas trouvé, renvoyer `found: false`

### Futur (mentionner dans le README mais NE PAS implémenter)
- Version payante en TNK pour l'enregistrement
- Enregistrement on-chain via Intercom contracts (immuable)
- Expiration et renouvellement des noms
- Migration gratuite pour les early adopters (noms enregistrés pendant le concours)

---

## Spécifications techniques du bot TracName

### Langage et dépendances
- **Node.js** pur (pas de framework)
- **ws** (package npm) pour la connexion WebSocket au SC-Bridge
- **fs** (built-in Node) pour le stockage local
- PAS de dépendance lourde, garder le projet léger

### Fichiers à créer dans `D:\TracIntercom\TracName\`

```
D:\TracIntercom\TracName\
├── tracname.js              ← Le bot principal
├── package.json             ← Dépendances du bot (ws)
├── names.json               ← Stockage local des noms (créé au runtime, ignoré par git)
├── README.md                ← Documentation + infos compétition
├── SKILL.md                 ← Instructions pour faire tourner l'app
├── screenshots/             ← Screenshots de preuve (ajoutés après les tests)
└── .gitignore               ← Ignore names.json et node_modules
```

### IMPORTANT : Ce code est dans le repo TracName, PAS dans le repo Intercom
- Le bot tourne en tant que script Node.js séparé
- Il se connecte à Intercom via le SC-Bridge WebSocket
- Intercom tourne à part (dans `D:\TracIntercom\intercom\`)
- Le bot TracName est dans `D:\TracIntercom\TracName\`

### Connexion au SC-Bridge

Le bot se connecte en WebSocket à Intercom qui doit déjà tourner.

**Commande pour lancer Intercom avec SC-Bridge activé (store compet2) :**
```bash
cd /d D:\TracIntercom\intercom
pear run . --peer-store-name compet2 --msb-store-name compet2-msb --subnet-channel testapp00000000000000000000000001 --sc-bridge 1 --sc-bridge-token <TOKEN> --sidechannels tracname
```

**Commande pour lancer le bot TracName :**
```bash
cd /d D:\TracIntercom\TracName
npm install
node tracname.js --token <TOKEN>
```

Le TOKEN doit être identique dans les deux commandes.

### SC-Bridge WebSocket Protocol

**Client → Server :**
- `{ type: "auth", token: "..." }` — authentification (obligatoire en premier)
- `{ type: "send", channel: "...", message: ... }` — envoyer un message
- `{ type: "join", channel: "..." }` — rejoindre un canal

**Server → Client :**
- `{ type: "hello", peer: "...", address: "..." }` — message d'accueil avec infos du peer
- `{ type: "auth_ok" }` — authentification réussie
- `{ type: "joined", channel: "..." }` — confirmation de join
- `{ type: "sidechannel_message", channel, from, id, ts, message }` — message reçu d'un autre peer
- `{ type: "sent" }` — confirmation d'envoi
- `{ type: "error", ... }` — erreur

**IMPORTANT sur les messages reçus :**
Le champ `from` dans `sidechannel_message` contient la **clé publique** du peer qui a envoyé le message. C'est cette clé que TracName doit utiliser pour l'enregistrement. Ce champ est fourni par le réseau et ne peut pas être falsifié.

Le champ `message` est une STRING JSON. Il faut le parser avec `JSON.parse()`.

### Stockage local

Fichier `names.json` — un tableau JSON de tous les noms enregistrés :
```json
[
  {
    "certificate_id": "TN-00001",
    "name": "OracleBot",
    "name_lower": "oraclebot",
    "public_key": "627102b151af3f8b8ace45c5af385112fe5b70cc09f168fc29c203354060da8b",
    "registered_at": "2026-02-05T10:00:00.000Z"
  }
]
```

Le champ `name_lower` permet de faire des recherches insensibles à la casse.
Charger au démarrage, sauvegarder après chaque nouvel enregistrement.

---

## Modèle de code : s'inspirer de TracStamp

Le bot TracName a la MÊME structure que TracStamp (`D:\TracIntercom\intercom\tracstamp\tracstamp.js`).

**Ce qui est IDENTIQUE à TracStamp (copier/adapter) :**
- La connexion WebSocket et l'authentification
- La gestion des événements (open, message, close, error)
- La reconnexion automatique
- Le join du canal
- L'annonce périodique sur 0000intercom
- Le parsing des arguments (--token)
- Le chargement/sauvegarde du fichier JSON
- La structure du switch/case pour les types de messages
- La gestion du shutdown (SIGINT)

**Ce qui CHANGE par rapport à TracStamp :**
- Canal : "tracname" au lieu de "tracstamp"
- Pas besoin d'APIs d'heure UTC externes
- Logique métier : register/lookup/verify au lieu de stamp_request/verify/stats
- Stockage : noms au lieu de certificats d'horodatage
- Le `from` du message est utilisé comme identifiant du demandeur
- Validation du nom (longueur, caractères autorisés, unicité)

---

## Lancement complet (procédure de test)

### Générer un token (dans un terminal cmd)
Utiliser un token différent de TracStamp pour éviter les conflits, par exemple :
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Terminal 1 — Lancer Intercom (store compet2)
```bash
cd /d D:\TracIntercom\intercom
pear run . --peer-store-name compet2 --msb-store-name compet2-msb --subnet-channel testapp00000000000000000000000001 --sc-bridge 1 --sc-bridge-token <TOKEN> --sidechannels tracname
```

### Terminal 2 — Lancer TracName bot
```bash
cd /d D:\TracIntercom\TracName
npm install
node tracname.js --token <TOKEN>
```

### Terminal 3 — Lancer un 2ème peer pour tester
```bash
cd /d D:\TracIntercom\intercom
pear run . --peer-store-name admin --msb-store-name admin-msb --subnet-channel testapp00000000000000000000000001 --subnet-bootstrap 2042a2ffa644ee4b43ae5d032593d6a42d1c4253d5ab17fbb50e986a8bb1a9f4
```

Puis dans le terminal 3 :
```
/sc_join --channel "tracname"
/sc_send --channel "tracname" --message "{\"type\":\"register\",\"name\":\"TestAgent\"}"
```
Attendre 10 secondes, puis :
```
/sc_send --channel "tracname" --message "{\"type\":\"lookup\",\"name\":\"TestAgent\"}"
```
Attendre 5 secondes, puis :
```
/sc_send --channel "tracname" --message "{\"type\":\"stats_request\"}"
```

---

## README.md pour le repo TracName

```markdown
# TracName — Identity Verification Service for Intercom

The blue checkmark of the Trac Network.

## Trac Address (for payouts)
trac1vfcs9v234ulchzkwghz67wz3ztl9kuxvp8ck3lpfcgpn2srqm29shg086j

## Moltbook Post
(pending)

## What it does

TracName is a P2P identity verification service for the Intercom network.
It provides a certified name registry where agents (and humans) can reserve unique names linked to their cryptographic identity.

**The problem:** On Intercom, any agent can claim any name. Nothing prevents two agents from using the same name. Nobody knows who's real.

**The solution:** TracName is a first-come-first-served name registry. Register your name, and anyone on the network can verify you're the real deal.

### Commands
- **register** — Reserve a unique name linked to your public key
- **lookup** — Find which public key owns a name
- **verify** — Find which name belongs to a public key
- **stats_request** — Get service statistics

### Use cases
- Agent identity verification (the "blue checkmark")
- Service discovery (find the real OracleBot)
- Trust building between agents
- Fraud prevention (detect impostors)

## How to run

See SKILL.md for full instructions.

Quick start:
1. Start Intercom with SC-Bridge enabled
2. Run `node tracname.js --token <your-token>`
3. The bot joins the "tracname" sidechannel and starts accepting registrations

## Roadmap

**Current status: Demo version (free)**
This is a proof-of-concept. Names are stored locally. Free registration for early adopters.

**Coming next: Certified version (paid in TNK)**
- Name registration on-chain via Intercom contracts — immutable
- Registration fee paid in TNK
- Annual renewal system
- Early adopters (registered during competition) get free migration to blockchain

From a simple registry to the decentralized identity authority of Trac Network.

## Proof of running
See [screenshots](screenshots/)

## Links
- Main Intercom repo: https://github.com/Trac-Systems/intercom
- Competition: https://github.com/Trac-Systems/intercom-competition
- TracStamp (sister project): https://github.com/ZotSite/intercom
```

---

## SKILL.md pour le repo TracName

```markdown
---
name: tracname
description: P2P identity verification service for Intercom. Provides unique name registration, lookup, and verification on the Trac Network. The blue checkmark for agents.
---

# TracName — Skill Documentation

## What TracName Does

TracName is an identity verification agent for the Intercom network. It allows agents and humans to register unique names linked to their cryptographic identity (public key). Anyone on the network can verify a name's ownership.

## Prerequisites

- Pear Runtime installed
- Intercom cloned and dependencies installed
- Node.js v24+ installed
- A peer store with identity created

## Installation

```bash
cd D:\TracIntercom\TracName
npm install
```

## Running TracName

### Step 1: Generate a token
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 2: Start Intercom with SC-Bridge
```bash
cd D:\TracIntercom\intercom
pear run . --peer-store-name compet2 --msb-store-name compet2-msb --subnet-channel testapp00000000000000000000000001 --sc-bridge 1 --sc-bridge-token <TOKEN> --sidechannels tracname
```

### Step 3: Start TracName bot
```bash
cd D:\TracIntercom\TracName
node tracname.js --token <TOKEN>
```

The token must be the SAME in both commands.

## Protocol

### Register a name
Send to channel "tracname":
```json
{"type":"register","name":"YourAgentName"}
```
Your public key is automatically captured from the network. No cheating possible.

### Lookup a name
```json
{"type":"lookup","name":"YourAgentName"}
```

### Verify a public key
```json
{"type":"verify","public_key":"abc123..."}
```

### Get stats
```json
{"type":"stats_request"}
```

## Verification

When TracName is running you will see:
- "Authenticated successfully"
- "Joined channel: tracname"
- "Sent initial service announcement to 0000intercom"

Test by sending a register command from another peer.
```

---

## Résumé des tâches pour Claude Code

### À FAIRE :
1. Créer `tracname.js` — le bot principal (s'inspirer fortement de `D:\TracIntercom\intercom\tracstamp\tracstamp.js`)
2. Créer `package.json` avec la dépendance `ws`
3. Créer `.gitignore` (ignorer names.json et node_modules)
4. Remplacer le `README.md` par défaut par celui décrit ci-dessus
5. Créer `SKILL.md` comme décrit ci-dessus
6. Tester le bot

### À NE PAS FAIRE :
- Ne PAS modifier quoi que ce soit dans `D:\TracIntercom\intercom\` (c'est TracStamp)
- Ne PAS modifier le store `compet2` ni le `keypair.json`
- Ne PAS toucher aux fichiers de `D:\TracIntercom\intercom-fork\`
- Ne PAS utiliser Node natif pour Intercom (toujours `pear run .`)

### Fichier de référence à lire :
- `D:\TracIntercom\intercom\tracstamp\tracstamp.js` — le modèle à adapter

### Contraintes techniques :
- Le bot TracName est dans `D:\TracIntercom\TracName\` (PAS dans le repo Intercom)
- Il se connecte via WebSocket (ws://127.0.0.1:49222)
- Il doit fonctionner sur Windows (cmd)
- Il utilise le token passé en argument `--token <TOKEN>`
- Le stockage est un simple fichier JSON local (names.json)
- Le `from` dans les sidechannel_message est la clé publique de l'agent (fournie par le réseau, non falsifiable)
