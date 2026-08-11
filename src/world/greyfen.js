// The Greyfen March — starter world pack.
//
// One frontier province of *Sundermark*, the engine roadmap's 3.0.0
// setting (high fantasy, one twist: the gods died centuries ago).
// This pack is deliberately a slice, not the continent: when the
// full setting ships, the March folds in as one region of it. Scope
// is "run a campaign tonight": five regions, six factions, twelve
// NPCs, a three-tier secret ladder, and three ready openers.
//
// Layer discipline: every `gm` key on a region/faction/NPC, plus
// the whole `secrets` array, is GM-eyes-only. The world tools strip
// them unless `layer: "gm"` is asked for — reveal through play, via
// the breadcrumbs, never by pasting.
//
// All content here is original. Stat hints reference SRD 5.2
// creatures by name so `srd_get` / `monsters_elevate` can arm any
// scene without conversion.

export const greyfen = {
  id: 'greyfen-march',
  name: 'The Greyfen March',
  setting: 'Sundermark',
  tagline: 'A fen province living off the estate of its dead gods — and something under the water has started to drink the inheritance.',
  levelBand: '1-8 for the province arcs; the god-seed arc closes at 8-10.',
  pitch: 'Three centuries ago the Sundering killed every god in a single night. In the Greyfen March, faith became estate management: clerics draw miracles from rationed relics, séance-lamps let the desperate speak with echoes of the dead, and the fen keeps its own ledger of what is owed. Now relics are guttering out years ahead of schedule, the drowned bell rings on clear days, and pilgrims arrive following a heartbeat only they can hear.',
  tone: ['lantern-lit', 'damp and close', 'wry frontier stoicism', 'grief worn smooth by routine'],
  themes: [
    'inheritance — living off what the dead left, and what that does to the living',
    'authority without foundation — every power in the March is quietly bluffing',
    'the price of hope — a new god is the best and worst thing that could happen here'
  ],
  truths: [
    'The gods died in the Sundering, 312 years ago. Nobody knows why. The sky burned grey for a year.',
    'Divine magic still works, but only near relics — objects the gods touched, rationed by the Relicwardens. A cleric\'s prayer is a withdrawal, not a conversation.',
    'The dead linger as echoes. The Lantern Court\'s séance-lamps can tune them in, for a fee.',
    'The fen is older than the province and does not entirely obey it. Locals pay small courtesies: a coin in the reeds, a name spoken backwards at a crossing.'
  ],

  gettingStarted: {
    startingLocation: 'wickmere',
    openers: [
      {
        id: 'the-fizzled-miracle',
        title: 'The Fizzled Miracle',
        hook: 'At a public funeral in Wickmere, Brother Ash\'s blessing of passage fizzles — the relic simply fails. The crowd turns ugly; a widow is screaming that her husband\'s echo will drown. Warden-Superior Lock quietly hires the party to trace "a fault in one relic" before the town notices the pattern.',
        firstScene: 'The funeral barge, mid-riot. Give the party a chance to calm the crowd (Persuasion DC 13, or any clever use of light) before Lock approaches them that evening at the Tidehall.'
      },
      {
        id: 'the-lantern-that-answered',
        title: 'The Lantern That Answered',
        hook: 'Séance-mother Maela Thrice-Lit hires the party as escort into Greyfen Deep, to the hermit Old Nod. She will say only this: in a routine séance, something used her lamp to speak that was not an echo — it asked a question. Echoes never ask.',
        firstScene: 'Maela\'s lamp-room above the Wickmere canal: three lit lanterns, one covered. She uncovers it. It is still warm. Old Nod heard the same voice thirty years ago, and the Court called him mad.'
      },
      {
        id: 'toll-of-the-bell',
        title: 'Toll of the Bell',
        hook: 'The drowned bell of the Wet Parish rang thirteen times on a cloudless morning. By dusk, a Peatlord barge is missing on the Saltcandle Causeway with Grandmother Eel\'s grandson aboard. The Compact blames smugglers; the Peatlords blame the Compact\'s tolls; Corporal Brine just wants riders who aren\'t on anyone\'s payroll.',
        firstScene: 'The Halfway Lamp inn at night: Brine, off duty, buys the party a round and lays out the timeline. The barge carried peat. It rode far too low in the water for peat.'
      }
    ]
  },

  timeline: [
    { year: '0 AS', event: 'The Sundering. Every god dies in one night; the sky burns grey for a year. Prayer stops answering mid-sentence.' },
    { year: '14 AS', event: 'Refugees from the coast raise Wickmere on stilts over the fen\'s only firm shallows.' },
    { year: '88 AS', event: 'The Relicwarden order is chartered to catalogue and ration what the gods left behind.' },
    { year: '141 AS', event: 'Surveyors find the Ledger-Father\'s petrified spine running south through the fen. The Saltcandle Causeway is paved along it; trade returns.' },
    { year: '203 AS', event: 'The Wet Winter. The Drowned Parish floods in a night; Velmara\'s cathedral is abandoned mid-mass. Its bell has rung by itself ever since.' },
    { year: '267 AS', event: 'The Lantern Court is granted the séance monopoly for the March.' },
    { year: '299 AS', event: 'First Hollow Choir pilgrims arrive, walking out of the south "following a heartbeat."' },
    { year: '309 AS', event: 'Relic potency dips across the whole March. The Relicwardens log it, reclassify the log, and say nothing.' },
    { year: '312 AS', event: 'Now. The Margravine\'s charter renewal has not come from the capital. The bell rings more often. The Choir has begun to sing at night.' }
  ],

  regions: {
    wickmere: {
      name: 'Wickmere',
      summary: 'The March\'s only town: a knot of stilt-houses, rope bridges and canal-markets around the Tidehall, lit all night by Lantern Court lamps. Everything in the March is for sale here twice — once openly, once under the sluice-gates.',
      travel: 'Hub of the March. Half a day by barge-pole to the Drowned Parish or the Causeway tollgate; two days poling to the Peat-Holds; the Deep is "as far as your nerve holds".',
      sites: [
        { name: 'The Tidehall', description: 'Margravine Crane\'s seat — a beached warship rebuilt as a keep, tide-scoured and creaking. The charter case in the great hall is displayed closed.' },
        { name: 'The Lamp Row', description: 'Séance parlours of the Lantern Court. Grief is queued, ticketed and tariffed. Maela Thrice-Lit keeps the oldest room.' },
        { name: 'The Wet Market', description: 'Canal-barge bazaar. Eels, peat, relic-splinters of dubious papers, and every rumour in the province at the price of buying something.' },
        { name: 'The Sluice-Gates', description: 'The under-town: maintenance tunnels and flooded cellars where the Black Sluice moves what the Wet Market cannot list.' }
      ],
      hooks: [
        'A Wet Market stall is selling "licensed" relic-splinters that Brother Ash swears were never issued — the papers are perfect.',
        'The Margravine wants a discreet party to carry her charter-renewal petition south — and to report honestly on what answers.',
        'Lamp Row\'s queue riots after a séance delivers a message from a man who turns out to be alive.'
      ],
      npcs: ['margravine-oswin-crane', 'maela-thrice-lit', 'tally-of-the-sluice', 'warden-superior-lock'],
      gm: {
        secret: 'Wickmere\'s stilts stand on the firm shallows because something vast and patient lies curled beneath them, sleeping shallowly enough that pilings never rot. The Choir knows. The fish know. Nobody else does.'
      }
    },
    'drowned-parish': {
      name: 'The Drowned Parish',
      summary: 'Velmara\'s flooded cathedral district: rooftops and bell towers standing out of black water, home now to the Relicwardens\' reliquary-vault and to the bell that rings without a hand.',
      travel: 'Half a day from Wickmere by barge. Locals will not stay past dusk; the Wardens keep a lit causeway of votive floats.',
      sites: [
        { name: 'The Reliquary Ark', description: 'The Wardens\' vault, built into the cathedral\'s dry upper nave. Potency ledgers, ranked relics, and Brother Ash\'s desk, which he never leaves before dark.' },
        { name: 'The Bell Tower', description: 'Velmara\'s great bell, green with the water it hangs over. It rings before disasters — hours, sometimes days. Counting the strokes is a local science and a gambling market.' },
        { name: 'The Under-Nave', description: 'The flooded cathedral floor. Divers report the pews are always freshly straightened.' }
      ],
      hooks: [
        'The bell rang thirteen — a count with no recorded precedent. The stroke-gamblers are offering fortunes for anyone who will dive the Under-Nave and look.',
        'A Warden postulant has vanished from the Ark with a mid-rank relic and, stranger, with three pages of the potency ledger.',
        'Velmara\'s echo has stopped attending séances held in her own parish. The Lantern Court wants to know why before the customers do.'
      ],
      npcs: ['brother-ash', 'the-bell-under-water'],
      gm: {
        secret: 'The bell is not haunted and not Velmara. It is resonating — struck from below, through the water table, by the same slow heartbeat the Choir follows. Thirteen strokes was not a warning. It was a contraction.'
      }
    },
    'saltcandle-causeway': {
      name: 'The Saltcandle Causeway',
      summary: 'The trade road south, paved along the petrified spine of Orsk the Ledger-Father. Toll-lamps burn tallow-white every mile; between them, the fen presses close and keeps its own tolls.',
      travel: 'Three days end to end, walking the spine. Leaving the causeway after dark is filed by the Compact under "self-inflicted".',
      sites: [
        { name: 'The Tollgate of Teeth', description: 'The north gate, built through what is unmistakably a jawbone. Corporal Brine\'s post: twelve levies, one ledger, no illusions.' },
        { name: 'The Halfway Lamp', description: 'Mirel\'s inn, the only warm room for a day in either direction. Everything spoken here is eventually heard in Wickmere.' },
        { name: 'The Vertebral Stairs', description: 'A maintenance descent between spine-segments, down to the waterline. Levies use it to check pilings. Other people use it for other things.' }
      ],
      hooks: [
        'Toll receipts and cargo manifests have stopped matching — someone is moving unlisted freight north, and Brine\'s superiors keep declining to investigate.',
        'A mile of toll-lamps went out in sequence at midnight, north to south, at walking pace. The lamp-oil was fine.',
        'Mirel is quietly hiring guards for "a guest who must reach Wickmere unseen" — a Choir defector who has stopped hearing the heartbeat and is terrified by the silence.'
      ],
      npcs: ['corporal-brine', 'mirel-of-the-causeway'],
      gm: {
        secret: 'The causeway is a spine and the spine is not entirely dead matter — Orsk\'s oath-keeping outlived him as reflex. Contracts sworn standing on the causeway enforce themselves: breakers sicken until they comply. The Black Sluice figured this out and now swears its most dangerous deals at the Vertebral Stairs.'
      }
    },
    'peat-holds': {
      name: 'The Peat-Holds',
      summary: 'The clan hinterland: turf-roofed holds on hummock-islands, connected by plank-ways the clans lift at night. The March burns Peatlord turf or the March freezes; everyone involved knows exactly what that is worth.',
      travel: 'Two days poling from Wickmere through channel-mazes. Without a clan guide, plan for a week and bring gifts.',
      sites: [
        { name: 'Eelmother Hold', description: 'Grandmother Eel\'s longhouse, ringed by smokehouses. Clan moots are held on her floor because nobody has ever won an argument on it.' },
        { name: 'The Cutting Fields', description: 'Generations-deep peat trenches. The oldest cuts expose things: antler tools, votive coins, and lately a stratum of turf that is warm to the touch.' },
        { name: 'The Reed-King\'s Ring', description: 'A circle of harvest-idols to dead Craw, maintained "for the look of it". Offerings still disappear overnight, which the clans decline to discuss.' }
      ],
      hooks: [
        'A cutting crew broke into a peat stratum that smoulders without being lit. The clan sealed the trench and posted guards who will not say what they are guarding.',
        'Grandmother Eel wants an outsider\'s eyes on the Compact\'s new turf-tithe assessor, who counts too well and asks about the wrong trench.',
        'Craw\'s ring-idols have all turned, overnight, to face south — toward the Deep. The clans are pretending very hard not to have noticed.'
      ],
      npcs: ['grandmother-eel'],
      gm: {
        secret: 'The warm stratum is god-grave peat — fen-matter composted for three centuries against the buried divine. It burns miracles: a brick of it can power a healing like a mid-rank relic, once. The clans have been quietly selling bricks through the Black Sluice for a decade. Every brick burned is a drop of the March\'s divine residue gone for good — and lately the bricks come out of the ground already half-drained.'
      }
    },
    'greyfen-deep': {
      name: 'Greyfen Deep',
      summary: 'The true fen: mist-drowned meres, ruins from before the province, and a silence with a texture to it. Compasses disagree here, politely. The Choir walks in singing; most other traffic does not walk in at all.',
      travel: 'No maintained routes. Guides: Issa Two-Debts, or a Choir pilgrim column, or nobody. Distances misbehave — plan in days of nerve, not miles.',
      sites: [
        { name: 'The Sunken Doors', description: 'A pre-Sundering ruin: a colonnade descending into black water, its lintels carved with lamps. Nithra\'s oldest shrine, say the songs. The doors at the bottom are shut, and the water above them is warm.' },
        { name: 'Old Nod\'s Stilts', description: 'The hermit\'s shack, moved every season, always found anyway by those he wants to see. Wind-chimes made of séance-lamp glass.' },
        { name: 'The Chapel of the Choir', description: 'The pilgrims\' camp: reed pavilions, communal cookfires, and the Gentle Warden\'s open ledger of arrivals. Unfailingly hospitable. The singing starts at dusk and is beautiful, which is somehow worse.' }
      ],
      hooks: [
        'Issa Two-Debts is offering to *pay* a party to accompany her back to the Sunken Doors — she left something there on her last run, and will not say whether it was cargo or a person.',
        'The Choir has invited the Margravine, the Wardens and the Peatlords to "attend a birth". Every faction wants eyes at that gathering that are not their own.',
        'Old Nod has started answering questions a day before they are asked, and it is exhausting him. He wants someone to carry a message to Maela while he can still tell which day he is in.'
      ],
      npcs: ['old-nod', 'the-gentle-warden', 'issa-two-debts'],
      gm: {
        secret: 'The Deep\'s misbehaving distances are contractions of a womb. Beneath the Sunken Doors, in the god-grave, something is gestating — see the secrets ladder. The warm water, the heartbeat, the turned idols, the drained peat: all one phenomenon, approaching term.'
      }
    }
  },

  factions: {
    relicwardens: {
      name: 'The Relicwardens',
      publicFace: 'The custodial order of the dead gods\' estate: they catalogue relics, ration miracles, and keep faith administratively alive. Grey-hooded, punctual, trusted the way a bank is trusted.',
      goals: 'Preserve relic potency for future generations; remain the indispensable arbiter of the divine remainder.',
      methods: 'Ledgers, licensing, potency audits, and the quiet confiscation of anything miraculous that lacks papers.',
      relations: {
        'lantern-court': 'Cold partnership — echoes are outside Warden jurisdiction and both sides prefer it that way.',
        'margraves-compact': 'Formal deference, practical leverage: the Compact needs blessed infrastructure more than the Wardens need the Compact.',
        'hollow-choir': 'Official policy is "harmless pilgrims". Internal memos have stopped using the word harmless.',
        'black-sluice': 'Publicly hunted. See gm.'
      },
      gm: {
        secret: 'The potency ledgers are falsified March-wide. Relics are failing years ahead of schedule and the order is stockpiling the strongest pieces in the Reliquary Ark — and moving them out of the province through, of all instruments, the Black Sluice. Warden-Superior Lock calls it "the estate\'s flight to safety". It looks exactly like the clergy looting the church.',
        weakness: 'The order\'s entire authority is the ledger\'s credibility. One published page of the real numbers and the March\'s faith economy runs on the bank.'
      }
    },
    'lantern-court': {
      name: 'The Lantern Court',
      publicFace: 'The séance guild: lamp-lighters and grief-brokers who tune the lingering echoes of the dead. They also, incidentally, light every public lamp in the March, which buys more goodwill than the séances do.',
      goals: 'Keep the monopoly; keep the lamps lit; keep grief orderly and billable.',
      methods: 'Tariffed séances, an examiner\'s guild for lamp-wrights, gentle blackmail made of twenty years of overheard bereavements.',
      relations: {
        relicwardens: 'Jurisdictional détente.',
        'margraves-compact': 'The Court lights the Compact\'s streets at cost and collects the favour with interest.',
        'hollow-choir': 'Professional loathing — the Choir gives away hope for free, which is unforgivable.',
        'peatlords': 'Warm: clan funerals are honest work and the clans pay in fuel.'
      },
      gm: {
        secret: 'A measurable share of séances are staged — trained voice-workers behind the lamp, scripts built from the Court\'s bereavement files. The monopoly could survive that scandal. What it could not survive is the other secret: in 282 AS a lamp in Maela\'s room answered *back*, asked "IS IT MORNING?", and the Court\'s masters buried the transcript and the career of the séance-mother who reported it. Old Nod was that career.',
        weakness: 'Its files. The Court knows everything about everyone\'s dead, which means one burgled archive makes an enemy of the entire March at once.'
      }
    },
    'margraves-compact': {
      name: 'The Margrave\'s Compact',
      publicFace: 'Secular rule: the Margravine, her charter from the southern capital, her levies, tolls and courts. Unloved, functional, and the only institution in the March that answers to something outside it.',
      goals: 'Hold the province together and solvent until the capital remembers it exists.',
      methods: 'Tolls, levies, charters, and Margravine Crane\'s personal talent for making bluff indistinguishable from law.',
      relations: {
        relicwardens: 'Mutual need dressed as protocol.',
        'lantern-court': 'Indebted for the lighting contract and aware of it.',
        'peatlords': 'A tithe war conducted entirely through assessors and passive aggression.',
        'black-sluice': 'The Compact hangs smugglers it catches and quietly prices its tolls assuming the ones it does not.'
      },
      gm: {
        secret: 'The charter lapsed in 305 AS. The capital has not answered a dispatch in seven years — not a refusal, silence. Crane has been forging the annual renewal seals herself. Her authority is a bluff with excellent posture, and she has started to wonder whether the capital is still *there*.',
        weakness: 'One genuine emissary from the south — or one look at the seal-press in her desk — ends the Compact overnight.'
      }
    },
    peatlords: {
      name: 'The Peatlords',
      publicFace: 'The fen clans in confederation: turf-cutters, eel-farmers, keepers of the old courtesies. They heat the March and never let it forget.',
      goals: 'Clan autonomy, fair fuel prices, and no outsiders in the cutting fields. Ever.',
      methods: 'The moot, the guide-monopoly, the plank-ways lifted at night, and the fact that the March freezes in a month if they stop cutting.',
      relations: {
        'margraves-compact': 'Tithe-feud, currently cold.',
        'lantern-court': 'Respected — the Court buries the clans\' dead properly.',
        'hollow-choir': 'The clans trade them food and refuse to discuss why they will not take Choir silver.',
        'black-sluice': 'Business. See gm.'
      },
      gm: {
        secret: 'The clans have been selling god-grave peat — the miracle-burning stratum — through the Black Sluice for a decade, at relic prices, to buyers who do not ask where relics grow. Grandmother Eel sanctioned it to keep the tithe war survivable. She has also seen the new bricks come up half-drained and warm, has drawn the correct conclusion, and is the only faction head who already believes the god-seed is real.',
        weakness: 'The moot. Clan law is consensus; prove to the moot that the trade is bleeding the fen\'s luck and the whole enterprise stops in one sitting — along with the income keeping the clans independent.'
      }
    },
    'hollow-choir': {
      name: 'The Hollow Choir',
      publicFace: 'Pilgrims of the heartbeat: gentle, generous, alarmingly organised. They feed strangers, mend nets, sing at dusk, and say — smiling, always smiling — that something wonderful is about to be born.',
      goals: 'Attend the birth. Prepare the March to welcome it. Be found worthy of having helped.',
      methods: 'Radical hospitality, tireless recruitment of the grieving, and a slow logistical convergence of people and supplies on Greyfen Deep.',
      relations: {
        'lantern-court': 'Pity, returned as loathing — "they charge admission to a closed door; we stand at an opening one".',
        relicwardens: 'Courteous avoidance. The Choir regards relics as "the estate of the previous tenants".',
        peatlords: 'Careful mutual respect and unpaid-for food.',
        'margraves-compact': 'Scrupulous toll-paying. The Choir\'s paperwork is immaculate, which unnerves the Compact more than banditry would.'
      },
      gm: {
        secret: 'The Choir is midwifing the god-seed. They hear the heartbeat truly; the Gentle Warden has heard it since childhood. They believe the newborn will be kind because everything they have felt from it is *hunger without malice* — and they are correct about the absence of malice, which is not the same as being correct about the outcome. The Choir does not know what the birth will cost (see secret s6), and most of them would sing on anyway.',
        weakness: 'Sincerity. The Choir cannot lie well, keeps open ledgers, and if shown convincingly that the birth harms the innocent, its members fracture — into those who stop, and those who decide the innocent are the price.'
      }
    },
    'black-sluice': {
      name: 'The Black Sluice',
      publicFace: 'Officially a myth. Practically: the under-market that moves what Wickmere cannot list — no colours, no name spoken twice in the same room, prices fair to the decimal because reputation is the only law down there.',
      goals: 'Margin, discretion, continuity. The Sluice has no ideology; it has invoices.',
      methods: 'The sluice-tunnels, the Vertebral Stairs oath-trick, Tally\'s books, and an iron rule: never touch cargo that sings, weeps or asks questions.',
      relations: {
        'margraves-compact': 'Predator and groundskeeper, in a rhythm old enough to be almost affectionate.',
        peatlords: 'Their best supplier. The Sluice suspects what the warm bricks are and has decided, profitably, not to know.',
        relicwardens: 'The Sluice\'s single most lucrative client. The irony is priced in.',
        'lantern-court': 'Avoided — the Court\'s files are the one surveillance the Sluice fears.'
      },
      gm: {
        secret: 'The Sluice\'s biggest contract is the Relicwardens\' relic-flight south — the hunters hiring the smugglers. Tally has noticed that the southern drop-points have stopped acknowledging receipt, exactly as long as the capital has been silent, and has begun quietly warehousing "delivered" relics in a flooded cellar instead. Nobody else knows the Sluice is sitting on the March\'s largest unlicensed reliquary.',
        weakness: 'Tally\'s books are the whole organisation — coded, memorised in part, and carried by a seventeen-year-old. Every faction in the March would burn a district for one evening alone with them.'
      }
    }
  },

  npcs: {
    'margravine-oswin-crane': {
      name: 'Margravine Oswin Crane',
      pronouns: 'she/her',
      role: 'Ruler of the March by charter; ruler in practice by nerve.',
      location: 'wickmere',
      faction: 'margraves-compact',
      voice: 'Clipped, dry, weaponised politeness; says "the capital will confirm" the way other people knock on wood.',
      wants: 'One genuine word from the south. Failing that, no witnesses to how long the silence has lasted.',
      fears: 'Not losing power — finding out there is nothing left to derive it from.',
      statHint: 'Use SRD noble for court scenes; knight if it comes to steel. She was a border officer before the title.',
      gm: {
        secret: 'She forges the annual charter seals herself (secret s2). The seal-press is in a false drawer in the Tidehall map table.',
        leverage: 'She will pay in charters, pardons and land for proof the capital still exists — and far more for silence about the drawer.'
      }
    },
    'maela-thrice-lit': {
      name: 'Maela Thrice-Lit',
      pronouns: 'she/her',
      role: 'Senior séance-mother of Lamp Row; the Court\'s best genuine talent.',
      location: 'wickmere',
      faction: 'lantern-court',
      voice: 'Speaks in threes ("Sit, breathe, listen."); never raises her voice because she has never needed to.',
      wants: 'To know whether the thing that answered her lamp in 282 was real — and to make amends to Old Nod if it was.',
      fears: 'That the Court\'s fakery has made her unable to trust her own gift.',
      statHint: 'SRD priest (reflavour divine casting as lamp-work); her three lanterns function as a focus.',
      gm: {
        secret: 'She kept a lamp-glass shard from the night of the Answer. It is still warm, thirty years on. Choir pilgrims turn to face it, without knowing why, when carried past.',
        leverage: 'She holds bereavement files enough to move half the town, and hates that she knows it.'
      }
    },
    'warden-superior-lock': {
      name: 'Warden-Superior Lock',
      pronouns: 'they/them',
      role: 'Head Relicwarden of the March; author of the flight-to-safety.',
      location: 'wickmere',
      faction: 'relicwardens',
      voice: 'Slow, deliberate, actuarial; discusses miracles exclusively in units of remaining uses.',
      wants: 'To get the estate\'s strongest relics out before the collapse — and history to record it as stewardship, not theft.',
      fears: 'Dying as the Warden who lost the March\'s faith. Also, increasingly, the audit.',
      statHint: 'SRD priest; in a crisis they will spend relics like ammunition, which is exactly the tell.',
      gm: {
        secret: 'Signs every falsified ledger page personally so no junior Warden hangs for it. Keeps the real numbers in cipher inside a hollowed hymnal.',
        leverage: 'Show them evidence the drain has a *cause* (the seed) rather than being entropy, and the entire flight-to-safety logic inverts — Lock becomes the party\'s most resourced ally overnight.'
      }
    },
    'brother-ash': {
      name: 'Brother Ash',
      pronouns: 'he/him',
      role: 'Quartermaster of the Reliquary Ark; the kind face of the rationing.',
      location: 'drowned-parish',
      faction: 'relicwardens',
      voice: 'Gentle, apologetic, tired; blesses by habit — doorframes, soup, passing dogs.',
      wants: 'For the relics to last one more winter, every winter.',
      fears: 'The next public fizzle. He has started testing relics in private first, which is against every rule he loves.',
      statHint: 'SRD acolyte, with one genuinely potent relic he is not supposed to still have.',
      gm: {
        secret: 'He falsifies the Ark\'s potency ledgers on Lock\'s orders and is quietly coming apart under it (secret s1 breadcrumb). His hands shake during blessings now — parishioners think it is age.',
        leverage: 'The first person to offer him confession instead of blackmail gets everything he knows.'
      }
    },
    'tally-of-the-sluice': {
      name: 'Tally',
      pronouns: 'she/her',
      role: 'Bookkeeper of the Black Sluice; seventeen; the most dangerous ledger in the province.',
      location: 'wickmere',
      faction: 'black-sluice',
      voice: 'Fast, precise, allergic to round numbers ("It\'s not \'about forty\'. It\'s thirty-eight.").',
      wants: 'To find out why the southern drop-points went silent — without letting anyone learn she is warehousing the undelivered relics.',
      fears: 'The day the Sluice decides its books are safer memorised and burned, along with the bookkeeper.',
      statHint: 'SRD spy (non-combatant by choice; her escape routes are pre-paid).',
      gm: {
        secret: 'Her cellar reliquary (see Black Sluice gm) has begun to hum on the nights the Choir sings. She has not told a soul.',
        leverage: 'Offer her the one thing the Sluice cannot invoice: a way out that keeps her alive and her conscience intact.'
      }
    },
    'grandmother-eel': {
      name: 'Grandmother Eel',
      pronouns: 'she/her',
      role: 'Matriarch of Eelmother Hold; first among the Peatlords when she chooses to be.',
      location: 'peat-holds',
      faction: 'peatlords',
      voice: 'Unhurried, proverb-armoured; answers questions with better questions.',
      wants: 'The clans independent and the fen unbled — and has discovered, too late, that her peat trade sets those against each other.',
      fears: 'That the fen keeps ledgers too, and the clans are deep in arrears.',
      statHint: 'SRD druid (the old courtesies are close enough to the old faith to still work, out here).',
      gm: {
        secret: 'She has personally seen the warm stratum breathe. She sanctioned sealing the trench and is preparing, alone, to argue before the moot for ending the god-peat trade — political suicide without outside proof of what it feeds (secret s3, s5).',
        leverage: 'Bring her that proof and the Peatlords swing behind the party as one clan.'
      }
    },
    'corporal-brine': {
      name: 'Corporal Brine',
      pronouns: 'he/him',
      role: 'Compact levy officer, Tollgate of Teeth; the Causeway\'s entire honest police force.',
      location: 'saltcandle-causeway',
      faction: 'margraves-compact',
      voice: 'Laconic, gallows-cheerful; files everything, believes a third of it.',
      wants: 'The manifests to add up, just once. And to know why his superiors keep closing the file that never adds up.',
      fears: 'That he already works for whoever is behind it, one uniform up.',
      statHint: 'SRD veteran; his tollgate levies are guards.',
      gm: {
        secret: 'He takes small bribes on small things — his tell for what he considers a big thing is that he suddenly cannot be bought at all. The unlisted freight file is a big thing.',
        leverage: 'He has copied three discrepant manifests into his personal logbook. It is enough to unravel the relic-flight, and he does not know what he is holding.'
      }
    },
    'mirel-of-the-causeway': {
      name: 'Mirel',
      pronouns: 'she/her',
      role: 'Keeper of the Halfway Lamp inn; the Lantern Court\'s ear on the road.',
      location: 'saltcandle-causeway',
      faction: 'lantern-court',
      voice: 'Warm, unhurried, remembers your drink and your debts; asks nothing twice.',
      wants: 'Safe passage north for her hidden guest — the Choir defector — before the Choir\'s rear-guard comes asking.',
      fears: 'Being made to choose between the Court\'s files and a guest under her roof. Her roof wins; she dreads the price.',
      statHint: 'SRD commoner with the information network of a spymaster; her regulars include two veterans who owe her.',
      gm: {
        secret: 'The defector stopped hearing the heartbeat the night the bell rang thirteen — the seed no longer needs the Choir\'s weakest voices, and the silence in his head is the first evidence the birth is near (breadcrumb for s5/s6).',
        leverage: 'Twenty years of overheard causeway talk, unfiled. Unlike the Court, she never wrote it down — which makes her testimony the only archive that cannot be stolen.'
      }
    },
    'the-gentle-warden': {
      name: 'The Gentle Warden',
      pronouns: 'they/them',
      role: 'Shepherd of the Hollow Choir\'s chapel-camp; the kindest antagonist the March has.',
      location: 'greyfen-deep',
      faction: 'hollow-choir',
      voice: 'Soft, unhurried, devastatingly sincere; thanks people for their anger.',
      wants: 'To welcome the newborn well — and to spare everyone the fear that, in their experience, curdles into cruelty.',
      fears: 'Nothing for themself. For the seed: that the March will meet it with knives, and teach it what knives are for.',
      statHint: 'SRD priest for the person; the devotion of the camp is the real stat block.',
      gm: {
        secret: 'They have heard the heartbeat since childhood and have felt it *listen back* since the thirteenth bell. They know something the rest of the Choir does not: lately the heartbeat skips — the birth can still fail. They have not decided whether they would permit it to.',
        leverage: 'They cannot lie. Asked a direct question in front of their own congregation, they will answer truly — the most dangerous dialogue mechanic in the pack.'
      }
    },
    'old-nod': {
      name: 'Old Nod',
      pronouns: 'he/him',
      role: 'Hermit of Greyfen Deep; former séance-master; the first to hear the Answer, thirty years early.',
      location: 'greyfen-deep',
      faction: null,
      voice: 'Tangential, tender, tenses drift ("You\'ll have asked me that tomorrow"); entirely lucid underneath, which takes visitors too long to notice.',
      wants: 'His name back in the Court\'s register before the end — not for pride; so the record shows somebody heard it and said so.',
      fears: 'That when the birth comes, he will finally be believed, and it will be much too late to matter.',
      statHint: 'SRD hermit/acolyte; his lamp-glass wind-chimes function as an early-warning system nothing in the SRD models — improvise.',
      gm: {
        secret: 'His time-slippage is not madness; proximity to the seed loosens sequence. He experiences the coming birth as a memory. Pressed gently, he can describe it — the single best intelligence in the campaign, wrapped in the least credible witness.',
        leverage: 'Maela\'s apology, delivered honestly, buys the party everything he knows in one sitting.'
      }
    },
    'issa-two-debts': {
      name: 'Issa Two-Debts',
      pronouns: 'she/her',
      role: 'Freelance relic-finder and the only guide who works the Deep alone.',
      location: 'greyfen-deep',
      faction: null,
      voice: 'Blunt, transactional, prices everything including apologies; laughs rarely and means it.',
      wants: 'To settle her two debts. She will not name either. One is to a person; the fen holds the other.',
      fears: 'The Sunken Doors — because on her last run, the doors were ajar, and she shut them, and she has been afraid ever since that this mattered.',
      statHint: 'SRD scout; treat her fen-craft as expertise in Survival and an effective pass on the Deep\'s misdirection.',
      gm: {
        secret: 'What she left at the Sunken Doors was a person: her partner, who walked through the ajar doors singing — a Choir believer to the end. The second debt is to him. Her offered "cargo run" is a rescue she cannot say aloud.',
        leverage: 'Help her open the doors and she is the party\'s blade and map for the endgame; force the truth early and she vanishes into the Deep for good.'
      }
    },
    'the-bell-under-water': {
      name: 'The Bell Under Water',
      pronouns: 'it/its',
      role: 'Not a person: Velmara\'s drowned bell, the March\'s oracle of last resort.',
      location: 'drowned-parish',
      faction: null,
      voice: 'Strokes only. The locals\' counting-rhymes ("three for storm, five for fire, nine for the Margrave\'s messenger") are folk statistics, roughly right.',
      wants: '—',
      fears: '—',
      statHint: 'A portent, not a creature. Mechanically: the DM\'s pacing instrument; ring it when a clock advances.',
      gm: {
        secret: 'It resonates to the heartbeat below the Deep (see region secret). Its counts are structural, not prophetic — thirteen was a contraction, and the intervals are shortening. Track them and the party can *derive* the due date.',
        leverage: '—'
      }
    }
  },

  secrets: [
    {
      id: 's1-the-ledgers-lie',
      tier: 1,
      truth: 'Relic potency across the March is failing years ahead of the official schedule. The Relicwardens\' public ledgers are falsified, signed by Warden-Superior Lock, maintained by Brother Ash, and the order is quietly evacuating the strongest relics south.',
      breadcrumbs: [
        'Brother Ash\'s hands shake during blessings; he tests relics in private before any public rite.',
        'A Wet Market relic-splinter with perfect papers that the Ark never issued.',
        'Corporal Brine\'s three manifests of unlisted southbound freight that no superior will investigate.'
      ]
    },
    {
      id: 's2-the-charter-lapsed',
      tier: 1,
      truth: 'The Margravine\'s charter lapsed in 305 AS. The southern capital has answered nothing in seven years, and Crane forges the renewal seals herself. Compact authority in the March is an unbroken bluff.',
      breadcrumbs: [
        'The charter case in the Tidehall is always displayed closed.',
        'No courier who carried dispatches south in living memory can be produced, only their receipts.',
        'The seal on this year\'s renewal is microscopically identical to last year\'s — same die-flaw, same ink-batch.'
      ]
    },
    {
      id: 's3-miracle-peat',
      tier: 2,
      truth: 'The Cutting Fields\' warm stratum is god-grave peat: it burns miracles like a relic, once per brick. The Peatlords have sold it through the Black Sluice for a decade with Grandmother Eel\'s sanction. Every brick burned permanently drains the March\'s divine residue.',
      breadcrumbs: [
        'A sealed trench under clan guard that no one will discuss.',
        'The vanished Causeway barge rode far too low for a peat cargo.',
        'A back-alley "healing" in Wickmere performed by someone with no relic license and a turf-smudged brazier.'
      ]
    },
    {
      id: 's4-the-staged-seances',
      tier: 2,
      truth: 'A share of Lantern Court séances are theatre — voice-workers and scripts built from the Court\'s bereavement files. Buried deeper: in 282 AS a lamp answered BACK, asking "IS IT MORNING?", and the Court destroyed the transcript and exiled the witness — Old Nod.',
      breadcrumbs: [
        'A séance delivers a message from a man who turns out to be alive.',
        'Lamp Row\'s cellar has a rehearsal room with cots, scripts, and a wall of family histories.',
        'Maela\'s covered fourth lantern, and the lamp-glass shard she keeps that has stayed warm for thirty years.'
      ]
    },
    {
      id: 's5-the-god-seed',
      tier: 3,
      truth: 'Beneath the Sunken Doors, in the grave of the god Nithra, something is gestating: a god-seed — either Nithra returning or something new conceived in the death of all gods; even the Choir does not know which. It has been drinking the March\'s divine residue for decades (the relic drain, the half-drained peat) and it is near term. The heartbeat is real. The bell counts contractions.',
      breadcrumbs: [
        'Every tier-1 and tier-2 secret, traced one level deeper, converges here: the drain has a single cause.',
        'Craw\'s ring-idols turned overnight to face the Deep; compasses in the Deep disagree politely.',
        'Old Nod\'s "memories" of an event that has not happened yet; the defector who stopped hearing the heartbeat at the thirteenth bell.'
      ]
    },
    {
      id: 's6-what-the-birth-costs',
      tier: 3,
      truth: 'A god is not born from nothing. At term, the seed will draw in every remaining drop of divine residue in the March and beyond in one breath: every relic inert, every echo silenced mid-sentence, every séance-lamp dark — the dead gone for good, this time. What is born may be worth it. The campaign\'s final question is who gets to decide, and the pack deliberately does not answer it: midwife the birth, still-birth it at the Doors, or find the third road (feed it the Sluice\'s warehoused relics early, on the March\'s terms) — all three are playable endings.',
      breadcrumbs: [
        'The Gentle Warden, asked directly before their congregation, cannot lie about what the heartbeat takes.',
        'Tally\'s hidden reliquary hums on singing nights — potency flows toward the Deep even through stone and water.',
        'Old Nod\'s remembered birth includes, every time he tells it, the same detail he cannot explain: "and then it was so quiet in the lamp-rooms".'
      ]
    }
  ],

  pantheon: {
    note: 'All gods are dead. What follows is estate, not theology: what each left in the March, and who administers it. Clerics of any SRD domain fit — reflavour their power source as relic-draw, echo-pact or old-courtesy.',
    deadGods: [
      { name: 'Velmara, the Tidemother', domain: 'harbours, mercy, safe crossing', whatRemains: 'The Drowned Parish, the font-shell relics, and the bell that was hers ringing to a rhythm that is not.' },
      { name: 'Orsk, the Ledger-Father', domain: 'oaths, trade, fair measure', whatRemains: 'His petrified spine (the Saltcandle Causeway) and a lingering reflex for enforcing contracts sworn upon it.' },
      { name: 'Nithra, the Lamp-Bearer', domain: 'guidance, dusk, the recently dead', whatRemains: 'The séance-craft itself — the Lantern Court\'s art descends from her rites — the Sunken Doors, and whatever gestates behind them.' },
      { name: 'Craw, the Reed-King', domain: 'harvest, rot, patient growth', whatRemains: 'The fen\'s old courtesies, the ring-idols, and offerings that continue to be accepted by *something*.' }
    ]
  },

  runningNotes: [
    'Reveal by ladder: run tier-1 secrets (ledgers, charter) as act one — they make the March feel corrupt but mundane. Let tier-2 complicate the corruption into survival strategies. Hold tier-3 until the players themselves say "these are connected".',
    'The bell is your pacing dial: ring it when a faction clock advances. Publish the counting-rhymes early so strokes feel legible; break the rhyme (thirteen) only when you mean it.',
    'Divine magic should feel like borrowing from a museum: ask clerics WHOSE relic powers today\'s spells, and make relic-draw visible in play (Brother Ash\'s ledger, potency dips) long before naming the cause.',
    'Every faction is sympathetic at exactly one altitude — the Wardens as stewards, the Choir as hope, the Compact as duty, the Sluice as fairness, the clans as survival, the Court as grief-work. Play each at its best altitude and let the players discover the cost floor.',
    'Ending stance: the pack takes none. Midwife, still-birth, or the third road (feed the seed early on the March\'s terms) — prep the consequences of each, not a canonical outcome.'
  ]
};
