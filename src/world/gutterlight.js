// The Gutterlight Yards — Brassgear world pack (slice).
//
// One city-state of *Brassgear*, the engine's 3.1.0 setting
// (magitech-noir, one twist: THE MAGIC IS DYING). Like the Greyfen
// March is to Sundermark, this pack is a slice, not the world: the
// salvage-city of Gutterlight, downstream of the capital on a
// failing pressure main. Canon ids line up with the engine pack
// (`BRASSGEAR_REGIONS.gutterlight`, Baron Null, Warden Tache,
// Actuary Fenn), so a table can run this slice tonight and mount the
// full setting later without renaming anyone.
//
// Layer discipline is identical to greyfen: every `gm` key and the
// whole `secrets` array are GM-eyes-only; the tools strip them
// unless `layer: "gm"` is asked for.
//
// All content original. Stat hints name SRD 5.2 creatures so
// `srd_get` / `monsters_elevate` can arm a scene without conversion.

export const gutterlight = {
  id: 'gutterlight-yards',
  name: 'The Gutterlight Yards',
  setting: 'Brassgear',
  tagline: 'A salvage-city living off the corpse of the magical-industrial age — and somebody down-main has started buying the corpse wholesale.',
  levelBand: '1-8 for the yard arcs; the reservoir arc closes at 8-10.',
  pitch: 'The Last Concord War bled the world\'s arcane reserves white. What pressure remains runs the lifts and the streetlamps of the old capital — and Gutterlight, the city downstream, lives on what the capital throws away. Scrappers break dead constructs for their brass; the Neutrality Office weighs every gram of salvage; the lamps burn dimmer every winter and everyone pretends not to keep count. Now whole yards of "dead" salvage are leaving the city on sealed barges, the pressure gauge on the public main reads the same three days running — which it has never done — and the scrappers\' children have started sleepwalking toward the Cold Manifold, all of them, on the same nights.',
  tone: ['gaslight and grease', 'boardroom menace', 'gallows solidarity', 'wonder gone to rust'],
  themes: [
    'inheritance in reverse — a generation dismantling what it can no longer build',
    'the ledger as weapon — whoever measures the decline owns it',
    'what the machines were for — every engine here was somebody\'s miracle once'
  ],
  truths: [
    'The magic is dying. Arcane pressure is a finite reserve, spent in the Last Concord War, and every gauge in the world is falling. Nobody has found new pressure in forty years.',
    'Spellcasting works but costs: every cast draws the local main down a little. Polite casters meter themselves. The desperate steal pressure the way other cities steal bread.',
    'Constructs outlived their makers. Most stand dead in the yards; a few still run on sealed hearts, and salvage law is very clear that a running construct is nobody\'s property until it stops.',
    'Gutterlight is the drain of the world: everything broken, banned or embarrassing comes here to be melted, and the city has learned to read a civilisation from what it throws away.'
  ],

  gettingStarted: {
    startingLocation: 'the-yards',
    openers: [
      {
        id: 'the-steady-gauge',
        title: 'The Steady Gauge',
        hook: 'The public pressure gauge in Union Square has read the same figure for three days. Falling is normal; steady is impossible. Foreman Cordray of the Lamplighters hires the party quietly: find out who is feeding the main, and why the Neutrality Office\'s inspectors walked past the gauge twice without writing it down.',
        firstScene: 'Union Square at lamplighting. The gauge needle does not move while the party watches — but the glass is warm, and last week\'s chalk marks under it have been washed off by someone who missed a spot.'
      },
      {
        id: 'lot-thirteen',
        title: 'Lot Thirteen',
        hook: 'Baron Null\'s auction floor lists Lot 13: "construct heart, non-running, provenance sealed". The Reclamation Crews say it IS running and was stolen from their cut. Warden Tache wants it back before the hammer falls — or failing that, wants to know who in the Office sealed the provenance of a beating heart.',
        firstScene: 'The Null Market preview hour. Lot 13 sits in a straw crate, officially inert. Anyone within arm\'s reach can feel it through the floorboards: a slow, patient tick. Ticking is not running, says the paperwork.'
      },
      {
        id: 'the-sleepwalkers',
        title: 'The Sleepwalkers',
        hook: 'On still nights, scrapper children rise and walk toward the Cold Manifold — all of them, the same nights, the same pace. They wake at the fence line, unharmed and embarrassed. Sister Gauge of the Still Current will pay in blessed lamp-oil for an escort INTO the Manifold: she believes something in there is calling, and she believes it is calling for help.',
        firstScene: 'A tenement kitchen on Pressure Row, 3 a.m. Four families, four children in coats over nightshirts, and Sister Gauge drawing the route the children walk on a fogged window — the same line, every time, toward the dead zone.'
      }
    ]
  },

  timeline: [
    { year: '0 LC', event: 'The Last Concord ends the war: the great houses sign, the reserves are audited, and the audit is the first document in history to use the phrase "terminal decline".' },
    { year: '6 LC', event: 'Gutterlight chartered as a salvage city — the Concord needs somewhere downstream to break what the war left, and somewhere to put the veterans who can\'t stop taking things apart.' },
    { year: '14 LC', event: 'The Neutrality Office opens its Gutterlight annex. Every gram of arcane salvage now crosses a Office scale before it crosses anything else.' },
    { year: '22 LC', event: 'The Cold Manifold accident: a reclamation crew cuts into a sealed distribution hub and eleven blocks go dark in a breath. The district is fenced and written off. The lamps there have never been relit.' },
    { year: '31 LC', event: 'Baron Null buys the auction floor, the debt registry and — the city notices too late — the fence contract for the Manifold, in the same quarter.' },
    { year: '38 LC', event: 'The Lamplighters\' Union wins the Dimming Accord: streetlamps burn at half-draw so tenement stoves can burn at all. The Office abstains from the vote, which everyone understood.' },
    { year: '40 LC', event: 'Now. Sealed barges leave the yards at night riding low. The Union Square gauge has stopped falling. The children walk.' }
  ],

  regions: {
    'the-yards': {
      name: 'The Yards',
      summary: 'The great salvage fields: acres of dead constructs, war hulks and engine-frames in sorted rows, worked by crews who can strip a colossus to the bone in a week. The city\'s heart, larder and graveyard in one.',
      travel: 'Everything in Gutterlight is half an hour from the Yards, because the Yards are half the city. Crews move by cart-track and crane-path; visitors keep to the flagged lanes or lose toes.',
      sites: [
        { name: 'The Breaking Rows', description: 'Sorted avenues of salvage — brass row, iron row, the sealed row nobody works without an Office writ. Row-bosses rule by seniority and lung capacity.' },
        { name: 'The Union Hall', description: 'The Lamplighters\' seat: half guild-hall, half pawnshop of last resort. The Dimming Accord hangs framed over the bar, annotated in four hands.' },
        { name: 'The Scale-House', description: 'The Neutrality Office\'s weighing floor. Everything salvaged crosses these scales; the ledgers go back thirty-four years and are said to balance to the gram, which is the most frightening sentence in the city.' }
      ],
      hooks: [
        'A breaking crew opened a war hulk and found the crew still at their stations — brass men, hands on levers, and one empty seat with the harness unbuckled from the inside.',
        'Row-boss Marta\'s brass row is coming up short: someone is stealing salvage AFTER it crosses the Office scales, which should be impossible and is definitely being blamed on the party\'s arrival.',
        'The Union posts a quiet bounty: a lamplighter walked his round into the Manifold fence three nights ago and has not come back. His lamp is still burning at the fence line. It has not gone out. It should have.'
      ],
      npcs: ['foreman-vell-cordray', 'row-boss-marta-kine', 'the-registrar-of-scales'],
      gm: {
        secret: 'The sealed row holds the Office\'s real business: constructs with running hearts, catalogued as dead, awaiting the night barges. The row-bosses know exactly what they are not looking at, and the Office pays the Yards\' widow-fund exactly enough to keep it that way.'
      }
    },
    'pressure-row': {
      name: 'Pressure Row',
      summary: 'The tenement district strung along the failing public main: stove-pipes tapped into lamp-lines, laundry over the valve-yards, and the finest informal pressure-metering culture in the world. Everyone here can read a gauge from a moving cart.',
      travel: 'Twenty minutes\' walk from the Yards along the main. After dark, walk with a lamplighter or walk loudly — the Row is safe for its own.',
      sites: [
        { name: 'Union Square', description: 'The public gauge, the lamplighting ceremony at dusk, and the chalk-market where families trade metered minutes of stove-draw like currency.' },
        { name: 'The Valve-Yards', description: 'The junction cellars where the main branches. Officially Office property; practically the Row\'s commons, plumbed by three generations of quiet expertise.' },
        { name: 'The Sisters\' Stovehouse', description: 'The Still Current\'s soup kitchen and chapel: free heat, free broth, and a sermon you can leave before. The stove burns steadier than its meter says it should.' }
      ],
      hooks: [
        'The chalk-market\'s exchange rate for stove-minutes has crashed — somebody flooded it with metered time that the main never delivered. Counterfeit pressure, in a city that can read gauges from carts.',
        'A Row plumber found a new pipe in the valve-yards: professional work, unmapped, running toward the Manifold fence, and warm.',
        'Sister Gauge\'s stovehouse meter reads impossibly light. The Office wants her audited for theft; the Row wants to know why the Office is suddenly interested in soup.'
      ],
      npcs: ['sister-gauge', 'pennywhistle'],
      gm: {
        secret: 'The Row\'s valve-cellars connect to the Cold Manifold through pre-accident plumbing the maps stopped showing in 22 LC. The children\'s sleepwalking route follows the old pipes exactly — they are walking the pressure home.'
      }
    },
    'null-market': {
      name: 'The Null Market',
      summary: 'Baron Null\'s auction floor and the debt registry above it: the one room where salvage, secrets and obligations all clear at the same hammer. The Baron\'s rule is famous — everything sells, nothing is discussed.',
      travel: 'The market quarter sits between the Yards and the harbour stairs; auctions on the sixth bell, previews from the fourth. The registry sees visitors by appointment, which is to say: when the Baron already knows why you\'ve come.',
      sites: [
        { name: 'The Auction Floor', description: 'A converted engine-shed, lots in straw crates, the hammer an actual forge-hammer. Provenance is displayed sealed; asking to unseal it costs the asking.' },
        { name: 'The Debt Registry', description: 'The Baron\'s other ledger: who owes whom, at what interest, secured on what. Half the city\'s politics is a marginal note here.' },
        { name: 'The Quiet Dock', description: 'The market\'s private wharf. The night barges load here, manifest sealed, riding low. The dockers are paid in Office scrip, which dockers normally refuse.' }
      ],
      hooks: [
        'Lot 13 (see the opener) is only the latest: running hearts have moved through the floor as "non-running" four times this season, always to the same sealed buyer.',
        'A page of the debt registry is being shopped around the Row — the page with the Lamplighters\' Union\'s refinanced mortgage on the Union Hall. The Baron does not lose pages.',
        'The Quiet Dock\'s tally-man wants out: he has counted the barges, done the arithmetic on what the city officially produces, and worked out that Gutterlight is exporting more pressure than it possesses.'
      ],
      npcs: ['baron-null', 'tally-man-brisk'],
      gm: {
        secret: 'Null is not the buyer — he is the broker, and he knows exactly what he is brokering: the Neutrality Office\'s annex is quietly buying every running heart in the city on behalf of the capital\'s House Concord, against the day the mains die. The Baron\'s price for silence was the one thing the Office could not refuse him: the original, unredacted survey of the Cold Manifold.'
      }
    },
    'the-cold-manifold': {
      name: 'The Cold Manifold',
      summary: 'Eleven blocks of dead city behind a fence: the distribution hub that failed in 22 LC, lamps unlit ever since, streets exactly as the evacuation left them. The city\'s ghost story, rent-collector of nightmares, and the one place salvage crews will not bid on.',
      travel: 'The fence has one legal gate (Office-locked) and, per the Row\'s children, at least three other opinions. Inside, unlit streets, cold that ignores the season, and the sensation — universally reported, universally unexplained — of being expected.',
      sites: [
        { name: 'The Hub', description: 'The dead distribution heart of the district, a cathedral of manifold pipe. The accident fused its doors. Recent scratches say something has been trying the hinges — from inside or outside depends on who is telling it.' },
        { name: 'The Held Breath', description: 'A street frozen mid-evacuation: carts loaded, doors open, one table still set. Nothing decays here at the proper speed. The Reclamation Crews\' one attempt to work it ended with the crew walking out in single file, not speaking, and never filing the report.' },
        { name: 'The Fence Line', description: 'Baron Null\'s contract, Office locks, Union lamps on the outside every fifty yards — the city\'s three powers agreeing, for once, on where the line is. The lamp that will not go out burns here now.' }
      ],
      hooks: [
        'The sleepwalking children all halt at the same gate — the one whose Office lock, on inspection, has been oiled.',
        'Warden Tache is assembling a crew for an unlogged entry: the Office has asked the Reclamation Crews to survey the Hub "informally", which is not a word the Office uses.',
        'The lamplighter who walked in (see the Yards) has been seen at second-storey windows, lamp in hand, waving — the wave lamplighters use for "main\'s live here".'
      ],
      npcs: ['reclamation-warden-tache', 'the-lamplighter-inside'],
      gm: {
        secret: 'The 22 LC accident was not a failure. The Hub sealed ITSELF: its governor-spirit — the last engine-saint\'s heart still beating anywhere — shut its own doors to stop the capital draining it, and put eleven blocks to sleep around it as insulation. It has held the city\'s reserve ever since. The steady gauge, the warm pipe, the children\'s walking: the Heart has begun, very carefully, giving the pressure back — to the Row, not the barges. It is calling for help because it cannot do both: feed the city and keep the doors shut against what the Office is preparing to cut.'
      }
    }
  },

  factions: {
    'the-lamplighters-union': {
      name: 'The Lamplighters\' Union',
      publicFace: 'The guild that keeps Gutterlight lit and heated: lamp rounds, valve-work, the Dimming Accord. The nearest thing the city has to a conscience with a membership roll.',
      goals: 'Keep the Row warm through one more winter, and the one after. Keep the Accord holding. Keep the count of the decline honest.',
      methods: 'The rounds, the chalk-market, strike arithmetic, and the fact that every valve in the city has been touched by a Union hand and remembers it.',
      relations: {
        'the-neutrality-office': 'Formal correctness over a live wire — the Office sets the draw; the Union lives it.',
        'the-scrap-barons': 'The Baron holds the Hall\'s mortgage and both sides price every conversation accordingly.',
        'the-reclamation-crews': 'Kin. Half the crews are lapsed lamplighters; funerals are shared.',
        'the-still-current': 'Wary gratitude — the Sisters heat what the Union cannot, and the Union prefers not to ask how.'
      },
      gm: {
        secret: 'Foreman Cordray has the Union\'s own gauge-books — thirty years of independent metering — and they show the decline curving WRONG: too fast city-wide, and lately, on the Row, not at all. The Union knows the official numbers are cooked; it does not yet know in which direction, and Cordray has not decided who may be told that the Row\'s stoves are burning borrowed miracle.',
        weakness: 'The mortgage. Baron Null can take the Union Hall — the rounds, the widow-fund, the Accord\'s meeting place — with one registry entry, and the Union\'s militancy is priced against that page.'
      }
    },
    'the-neutrality-office': {
      name: 'The Neutrality Office (Gutterlight Annex)',
      publicFace: 'The Concord\'s referees: they weigh salvage, meter the mains, certify provenance and take no side but the scale\'s. Grey coats, exact manners, thirty-four years of ledgers that balance.',
      goals: 'Officially: measurement. Actually: complete the Inventory — a full accounting of every running heart and live reserve in the city — before anyone else has one.',
      methods: 'Scales, seals, audits, abstentions, and the slow conversion of neutrality into the deepest information advantage in Brassgear.',
      relations: {
        'the-lamplighters-union': 'The Office sets the Accord\'s numbers and finds the Union\'s independent metering "admirably thorough", filed under threats.',
        'the-scrap-barons': 'A brokerage neither names aloud. See gm.',
        'the-reclamation-crews': 'Client and instrument: the Office writs the digs and reads the finds first.',
        'the-still-current': 'Under audit. A stove that outburns its meter is either fraud or physics, and the Office needs to know which before it decides which is worse.'
      },
      gm: {
        secret: 'The annex is running the relic-flight in reverse: buying every running heart through Null\'s floor for the House Concord, against the day the mains die — the capital means to survive the end of magic as its sole owner. The night barges are the Inventory leaving. The annex chief has standing orders for the Manifold: survey, then CUT — bleed the Hub\'s reserve into Concord tanks before the city learns it exists.',
        weakness: 'Neutrality is the asset. One proven side-taking — one unsealed manifest, one witnessed writ for the Manifold cut — and every scale-reading the Office has ever issued becomes negotiable, which unravels not just the annex but the Concord\'s claim to the salvage it already shipped.'
      }
    },
    'the-scrap-barons': {
      name: 'The Scrap Barons',
      publicFace: 'In Gutterlight, the Barons are one Baron: Null, who owns the floor where everything sells, the registry where everything owes, and the fence around the one thing that doesn\'t. Beyond the walls, his peers strip the world; here, he lets the world strip itself and takes the margin.',
      goals: 'Own the endgame. When the last gauge dies, Null intends to be holding the deeds to whatever still runs.',
      methods: 'Auctions, debt, sealed provenance, patience — and the Quiet Dock, where discretion is a scheduled service.',
      relations: {
        'the-neutrality-office': 'His best client and his favourite hostage: Null brokers their Inventory and keeps the receipts.',
        'the-lamplighters-union': 'A mortgage, held gently, like a knife in a velvet case.',
        'the-reclamation-crews': 'Buyer of everything they cut, insurer of half their gear, and the reason their finds are never quite theirs.',
        'the-still-current': 'The one door his money has not opened. It costs him sleep, which he resents more than the door.'
      },
      gm: {
        secret: 'Null holds the unredacted 22 LC Manifold survey — his price for brokering the Inventory — and he has read it. He knows the Hub sealed itself; he knows what a governor-heart of that age is worth; and he has quietly bought every debt of every family whose child sleepwalks, on the theory that the Heart is choosing its own heirs and the smart money follows.',
        weakness: 'Null\'s empire is paper: floor, registry, fence — all contracts. He owns nothing that runs and commands no loyalty that isn\'t priced. The day Gutterlight decides his paper doesn\'t bind — a burned registry, a moot-style repudiation, a Heart that voids his fence contract by simply opening the gates — he is a thin man in a good coat.'
      }
    },
    'the-reclamation-crews': {
      name: 'The Reclamation Crews',
      publicFace: 'The dig-and-cut professionals: they open what the war sealed, under Office writ, and hand up what they find. Hard, superstitious, honest by the standards of everyone who has never had to be first through a hatch.',
      goals: 'The cut, the fee, everyone home by bell. Lately, increasingly: to stop finding things that look back.',
      methods: 'Writs, torches, tally-discipline, and the crews\' law — first in names the find, nobody works the Manifold, nobody discusses why twice.',
      relations: {
        'the-neutrality-office': 'The hand that writs them. Respected, obeyed, and — since the "informal" Manifold survey request — quietly distrusted.',
        'the-scrap-barons': 'Sells to Null because everyone sells to Null; insures with him because the alternative is nothing.',
        'the-lamplighters-union': 'Family, with all that entails.',
        'the-still-current': 'The Sisters bless the crews\' torches without being asked and the crews have stopped pretending it doesn\'t help.'
      },
      gm: {
        secret: 'The crews have been finding live hearts for two years — and Warden Tache has been logging a percentage of them as dead and caching them in a flooded cut, because she worked out where the "dead" ones go and decided the capital\'s vault was the wrong address for the city\'s inheritance. Her cache is now the second-largest live reserve in Gutterlight, after the thing in the Manifold.',
        weakness: 'The writ system. The Office can starve the crews legally in a season — no writs, no digs, no fees — and Tache\'s cache makes every crew member an accessory the moment it surfaces.'
      }
    },
    'the-still-current': {
      name: 'The Still Current',
      publicFace: 'A lay sisterhood of the old engine-faith: soup, heat, funerals for the unclaimed, and the doctrine that the magic is not dying but WITHDRAWING — pulling back from a world that spent it like coal, waiting to see what the world does next.',
      goals: 'Tend the withdrawal. Keep faith visible where the gauges fall. Be worth returning to.',
      methods: 'The stovehouse, the blessing rounds, deathbed listening, and an intimacy with the city\'s pipes that the Office would call heresy if it could call it anything.',
      relations: {
        'the-lamplighters-union': 'Sisters and lamplighters share the same rounds at different hours and the same opinion of the Office at the same volume: quiet.',
        'the-neutrality-office': 'Under audit and serenely unbothered, which is making it worse.',
        'the-scrap-barons': 'The Sisters bury the Baron\'s unclaimed dead free of charge and refuse his donations, a ledger entry he cannot close.',
        'the-reclamation-crews': 'The Current blesses the torches. The crews come back. Nobody theorises.'
      },
      gm: {
        secret: 'Sister Gauge\'s doctrine is not metaphor. The Current\'s founders were the Hub\'s last acolytes; the stovehouse stove is plumbed — through pre-accident pipe — to the Manifold\'s Heart, which feeds it as a kindness. Gauge knows the Heart is real, knows it is calling, and believes the children are being called as WITNESSES, not victims: the Heart wants the city present when it decides. She is the only person in Gutterlight who wants the doors open for a reason that isn\'t leverage.',
        weakness: 'Sincerity, again, and plumbing: prove the stove\'s draw and the Current is a theft ring in canon law — every bowl of soup evidence, every Sister an accomplice, and the Office holds the meter.'
      }
    }
  },

  npcs: {
    'baron-null': {
      name: 'Baron Null',
      pronouns: 'he/him',
      role: 'The Scrap Baron of Gutterlight: auctioneer, debt-holder, fence-contract landlord.',
      location: 'null-market',
      faction: 'the-scrap-barons',
      voice: 'Soft, unhurried, third person for himself in negotiations ("the Baron finds that price whimsical"); never repeats an offer.',
      wants: 'The deeds to whatever survives the end of magic — and one thing money has not bought him: a door the Still Current keeps closed to him.',
      fears: 'Paper becoming just paper. He has no other empire.',
      statHint: 'SRD noble for the floor; his bodyguard pair are veterans. Null himself never touches anything heavier than a gavel.',
      gm: {
        secret: 'Holds the unredacted Manifold survey and has bought the debts of every sleepwalking child\'s family (secret s5 adjacency). He is hedging on the Heart choosing heirs.',
        leverage: 'The registry. Also: he would trade the survey itself — the whole endgame — for genuine admission into whatever the Still Current is tending. He suspects it is the only club that will matter.'
      }
    },
    'foreman-vell-cordray': {
      name: 'Foreman Vell Cordray',
      pronouns: 'they/them',
      role: 'Foreman of the Lamplighters\' Union; keeper of the Accord and the Union\'s own gauge-books.',
      location: 'the-yards',
      faction: 'the-lamplighters-union',
      voice: 'Talks in draw-arithmetic ("that\'s four stove-hours you\'re asking, friend"); goes very still instead of angry.',
      wants: 'The real decline curve, published, with the Union\'s name on the arithmetic — and the Hall\'s mortgage burned first, because the truth is unaffordable while Null holds the paper.',
      fears: 'That the Row\'s steady stoves are a loan the city cannot repay, and that they signed for it by saying nothing.',
      statHint: 'SRD scout (city-tuned); with the round-hook, treat as a spear.',
      gm: {
        secret: 'Has independently confirmed the public gauge is being fed (secret s1) and is sitting on it until the mortgage is safe. Their gauge-books are the only honest thirty-year record in Brassgear.',
        leverage: 'The books. The Office would trade almost anything to see them; the Union would break Cordray for showing them.'
      }
    },
    'row-boss-marta-kine': {
      name: 'Row-Boss Marta Kine',
      pronouns: 'she/her',
      role: 'Boss of brass row, dean of the breaking crews, chair of the widow-fund.',
      location: 'the-yards',
      faction: 'the-reclamation-crews',
      voice: 'Foghorn cheerful, obituary precise; names every hulk "she" and every Office clerk "sir" with the same intonation.',
      wants: 'Her row\'s count to balance and her crews above ground. In that order, and she is not proud of the order.',
      fears: 'The sealed row. She signs its widow-fund receipts and will not walk its lane.',
      statHint: 'SRD veteran; her breaking-maul counts as a maul, obviously.',
      gm: {
        secret: 'She found the empty seat in the war hulk (the Yards hook) unbuckled from the inside a WEEK before the crew did, and re-buckled it, and has been standing crews down that lane ever since on invented pretexts.',
        leverage: 'The widow-fund receipts tie the Office\'s hush-money to named signatures. She keeps them in the one place no one audits: the fund\'s own poor-box.'
      }
    },
    'the-registrar-of-scales': {
      name: 'The Registrar of Scales',
      pronouns: 'she/her',
      role: 'Chief of the Neutrality Office annex; the woman whose ledgers balance.',
      location: 'the-yards',
      faction: 'the-neutrality-office',
      voice: 'Passive constructions exclusively ("an irregularity has been noted"); thanks people for information the way a trap thanks a foot.',
      wants: 'The Inventory complete and the Manifold cut executed before the capital sends someone with her title and none of her restraint.',
      fears: 'She has read the same survey Null has. She is the only Office officer who has. She no longer believes the cut is a salvage operation, and she executes it anyway or loses the post to someone who\'ll enjoy it.',
      statHint: 'SRD noble statistics; her two escort clerks are guards who move like spies.',
      gm: {
        secret: 'Her standing orders (secret s4) carry her counter-signature. Her private annotation on the survey — recovered, it would end her — reads: "It sealed the doors to save them. Recommend we not be the ones to teach it otherwise."',
        leverage: 'She will deal — quietly, deniably — with anyone who can make the cut impossible without making it traceable to her desk.'
      }
    },
    'reclamation-warden-tache': {
      name: 'Reclamation Warden Tache',
      pronouns: 'she/her',
      role: 'Senior warden of the Reclamation Crews; holder of the Manifold survey writ she has not filed.',
      location: 'the-cold-manifold',
      faction: 'the-reclamation-crews',
      voice: 'Says little, counts aloud constantly — crew, exits, minutes of torch. Numbers are how she prays.',
      wants: 'To hand the city its inheritance instead of watching it barge south — and to get through the Hub survey without her crews learning what she already suspects is inside.',
      fears: 'Her cache surfacing before the Office\'s crimes do. The order of revelations is everything.',
      statHint: 'SRD veteran; underground, give her pick advantage on any check involving pipe, seal or structural nerve.',
      gm: {
        secret: 'Runs the dead-heart cache (faction secret) AND has walked the Manifold alone, twice, to the Hub doors. Both times, something on the other side matched her breathing. She has told no one, including herself, in so many words.',
        leverage: 'Her cache could arm or ransom the whole third act. She will spend it — for the city, never for herself, and she needs outsiders clean of writ-law to move it.'
      }
    },
    'sister-gauge': {
      name: 'Sister Gauge',
      pronouns: 'she/her',
      role: 'Elder of the Still Current; keeper of the stovehouse and the withdrawal doctrine.',
      location: 'pressure-row',
      faction: 'the-still-current',
      voice: 'Serene, second person plural ("you\'ll all sit; you\'ll all eat"); answers questions with soup first.',
      wants: 'The Heart\'s call answered gently — witnesses to walk in by daylight, invited, before the Office walks in with cutters.',
      fears: 'Not the audit. That the Heart, refused long enough, will stop asking — and do what patient things do when asking fails.',
      statHint: 'SRD priest; her "blessings" are real and metered, which is the whole scandal.',
      gm: {
        secret: 'Knows the stove\'s true plumbing and the founders\' history (faction secret). Keeps the Current\'s first relic — a governor-valve key, worn smooth — on a cord under her habit. It is warm. It fits something in the Hub.',
        leverage: 'She can open the legal gate\'s inner door — the one the Office\'s locksmiths pretend isn\'t there — but only, she insists, for people the children would follow.'
      }
    },
    'pennywhistle': {
      name: 'Pennywhistle',
      pronouns: 'he/him',
      role: 'King of the Row\'s children; twelve years old; sleepwalker with the longest recorded route.',
      location: 'pressure-row',
      faction: null,
      voice: 'Rapid, transactional, oddly formal under pressure; whistles gauge-readings in Union code faster than adults can read them.',
      wants: 'By day: chalk-minutes, dares, prestige. Asleep: the gate. Awake and honest, once: "to answer it, because it always asks so nicely."',
      fears: 'Waking up on the WRONG side of the fence with everyone watching. Also — new, unspoken — that the asking has started to sound tired.',
      statHint: 'SRD commoner (child); as a guide he grants passive knowledge of Row plumbing no adult possesses.',
      gm: {
        secret: 'Pennywhistle can hear the Heart awake now, faintly, and has begun answering in gauge-whistle at night from his window. The other children follow HIM on the walks. The Heart has, in effect, a herald, and neither party has told the adults.',
        leverage: 'Every faction will eventually want the children\'s route. The children will do what Pennywhistle says. Pennywhistle will do what a good dare, kindly meant, makes honourable.'
      }
    },
    'tally-man-brisk': {
      name: 'Tally-Man Brisk',
      pronouns: 'he/him',
      role: 'Count-keeper of the Quiet Dock; the man whose arithmetic doesn\'t balance.',
      location: 'null-market',
      faction: 'the-scrap-barons',
      voice: 'Whispered totals, chewed pencil, apologises to numbers when he rounds them.',
      wants: 'Out — with his family, his fingers and a testimony sold to exactly one buyer, because selling it twice is how tally-men stop needing fingers.',
      fears: 'That he has already been noticed. (He has.)',
      statHint: 'SRD commoner; what he carries is the manifest arithmetic, not a weapon.',
      gm: {
        secret: 'His private tally proves the export overrun (secret s3) AND that three barges never reached the capital — logged delivered, never acknowledged. Somewhere downstream, someone is skimming the skim, and Brisk\'s copy is the only evidence either theft occurred.',
        leverage: 'The Registrar, Null and Cordray would each pay ruinously for his book — and each would need him silenced after. His only safe buyer is someone with no stake, which is the party\'s whole job description.'
      }
    },
    'the-lamplighter-inside': {
      name: 'Odo Ferrant, the Lamplighter Inside',
      pronouns: 'he/him',
      role: 'The Union\'s missing man: walked his round through the fence three nights ago and kept walking it.',
      location: 'the-cold-manifold',
      faction: 'the-lamplighters-union',
      voice: 'Formerly: hummed the rounds-song. Currently: signs from windows in perfect Union hand-code, always the same message — "main\'s live here."',
      wants: 'Unknown. He waves. He lights lamps that have been dark for eighteen years, one per night, in strict round order.',
      fears: 'Unknown. He does not appear afraid. That is what frightens the Union.',
      statHint: 'Treat as SRD commoner if flesh; the GM knows whether he still is. He never approaches; he ATTENDS.',
      gm: {
        secret: 'Odo is alive, fed and — by his own lights — on shift: the Heart drafted the one professional whose oath ("no lit lamp abandoned, no dark lamp passed") it could speak to honestly. He is relighting the district in rounds order because the Heart is preparing the streets for people to come back. He waves because he is glad to see them.',
        leverage: 'He will open the route to the Hub for anyone who finishes his OLD round with him — the Row\'s lamps, dusk to dusk — because that is how a lamplighter learns whether your word holds.'
      }
    }
  },

  secrets: [
    {
      id: 's1-the-gauge-is-fed',
      tier: 1,
      truth: 'The Union Square public gauge reads steady because the main is being quietly fed — real pressure, arriving through unmapped pre-accident pipe from the direction of the Cold Manifold. The Office\'s inspectors have noticed and been ordered, in writing, not to notice.',
      breadcrumbs: [
        'Chalk marks under the gauge washed off, but only where a ladder would stand.',
        'A Row plumber\'s find: professional, unmapped, WARM pipe running fenceward.',
        'Two Office inspectors walking past a miracle twice without opening their books — inspectors open their books at weather.'
      ]
    },
    {
      id: 's2-the-dead-hearts-run',
      tier: 1,
      truth: 'Running construct hearts are being catalogued as dead — by the Office at the scales, by sealed provenance at Null\'s floor — and shipped south on the night barges. The city\'s live inheritance is leaving as certified scrap.',
      breadcrumbs: [
        'Lot 13 ticking through the floorboards of its own preview.',
        'The sealed row\'s widow-fund receipts paying for accidents that were never logged.',
        'Dockers taking Office scrip at the Quiet Dock — dockers refuse scrip unless someone is buying their silence too.'
      ]
    },
    {
      id: 's3-the-export-overrun',
      tier: 2,
      truth: 'Brisk\'s tally proves Gutterlight exports more pressure and live salvage than it officially possesses — the Inventory is real, it is leaving, and part of it is being skimmed in transit by an unknown third hand. The Office\'s perfect ledgers balance because they are audited against their own lie.',
      breadcrumbs: [
        'Barges riding low against manifests that say "inert brass".',
        'Brisk apologising to his numbers and drinking like a man who has finished counting.',
        'Three "delivered" barges the capital has never acknowledged — receipts exist; acknowledgements do not.'
      ]
    },
    {
      id: 's4-the-cut-order',
      tier: 2,
      truth: 'The Office annex holds counter-signed standing orders for the Cold Manifold: survey the Hub, then cut its reserve into Concord tanks. Tache\'s "informal survey" is the reconnaissance. The Registrar has read the true survey, believes the cut is close to a murder, and will execute it anyway unless it becomes impossible without her fingerprints.',
      breadcrumbs: [
        'The word "informally" in an Office request — the Office does not have that word.',
        'The legal gate\'s lock, oiled, though no writ for entry exists.',
        'The Registrar\'s clerks quietly pricing cutting-torches rated for governor-pipe, which has not been milled in forty years.'
      ]
    },
    {
      id: 's5-the-heart-under-the-manifold',
      tier: 3,
      truth: 'The 22 LC accident was the Hub saving itself: its governor-spirit — the last engine-saint\'s living heart — sealed its own doors against the capital\'s draining and slept eleven blocks around it as insulation. It has held Gutterlight\'s true reserve for eighteen years and has now begun giving it back: feeding the Row\'s stoves and the public gauge, drafting a lamplighter to relight the streets, calling the children as witnesses. It is asking the city to come take its inheritance home — before the Office cuts, or before holding both doors and kindness open exceeds even a saint\'s pressure. Every faction\'s endgame converges on those doors; the pack takes no stance on what SHOULD walk through them first.',
      breadcrumbs: [
        'The children\'s route mapping, pipe for pipe, onto plumbing erased from the city maps in 22 LC.',
        'Sister Gauge\'s valve-key, warm on its cord, worn smooth by no hand living.',
        'Odo\'s lamps coming alight in rounds order — the district being MADE READY, street by street, for someone\'s return.',
        'The Held Breath\'s set table: the evacuation was never meant to be permanent. Something has been keeping dinner warm.'
      ]
    }
  ],

  pantheon: {
    note: 'Brassgear\'s faith was industrial: the engine-saints were real governor-spirits, grown in the great works, venerated as patrons and spent as fuel in the Last Concord War like everything else. This is estate, not theology — what each saint left in Gutterlight, and who administers the remainder. Clerics fit as engine-faith tenders; reflavour any SRD domain as pressure-craft, tally-rite or the old rounds.',
    deadGods: [
      { name: 'The Cog-Mother, Verene of the First Works', domain: 'making, maintenance, the dignity of labour', whatRemains: 'The rounds-songs, the Union\'s oath-forms (her litanies, filed under folklore), and every tool in the Yards that fits the hand a little too well.' },
      { name: 'Saint Manifold, the Distributor', domain: 'fair shares, flow, the common main', whatRemains: 'The distribution network itself — his body, canonically — and one heart still beating under the Cold Manifold, which changes the tense of everything in this entry.' },
      { name: 'The Gauged One', domain: 'measure, honesty, the reading that cannot be argued with', whatRemains: 'The Office\'s scale-rites descend from her orders — a lineage the Office has spent thirty years denying while keeping her feast-day audit to the hour.' },
      { name: 'Brand of the Quenching, the Merciful Shutdown', domain: 'endings, safe failure, the flame put out in time', whatRemains: 'The fence-line custom of a lamp for the dead zone, the breakers\' habit of thanking a hulk before the first cut, and the Still Current\'s funeral rite — which is his, unchanged.' }
    ]
  },

  runningNotes: [
    'Run the decline as weather: open sessions with the gauge reading, dim a lamp mid-scene, price things in stove-minutes. The steady gauge should land like the bell\'s thirteenth stroke — wrongness in a system the table has learned to read.',
    'Reveal by ladder: tier-1 makes the city corrupt but mundane (cooked ledgers, laundered hearts). Tier-2 complicates corruption into strategy — everyone stealing the inheritance is half-right about why. Hold the Heart until the players say "the pipes, the children, the lamps — these are connected."',
    'The Office is scariest polite, Null scariest generous, the Current scariest right. Keep the three registers distinct and the noir stays humane.',
    'The children are a line the pack draws on the GM\'s side: they are witnesses, never leverage in play. Factions may THREATEN the route; the dice should never endanger a sleepwalker — the horror is the adults\' arithmetic, not the kids\' danger.',
    'Ending stance: none taken. The Office cut, Tache\'s civic inheritance, Null\'s priced succession, Gauge\'s open invitation, or the doors staying shut another forty years — prep consequences, not a canon. The one fixed point: the Heart is patient, kind, and finite, in that order.'
  ]
};
