// The Hollow Vale — gothic-horror world pack (slice).
//
// One small valley of *The Hollow Vale*, the engine's 3.2.0 setting
// (gothic horror, one twist: the Darklords are people the PCs knew,
// and every domain is a moral arc with a door out). This pack slices
// four of the canon domains — Bramblefell, the Chandlery, Hushwood
// and the Last Inn — sized to run a campaign tonight; the remaining
// domains stay beyond the mist until the full setting is mounted.
// Canon ids line up with the engine pack (`HOLLOW_VALE_REGIONS`,
// Maren Ovenwarm, Father Wick, Warden Mosswell, Halberd June).
//
// Layer discipline is identical to greyfen: every `gm` key and the
// whole `secrets` array are GM-eyes-only; the tools strip them
// unless `layer: "gm"` is asked for.
//
// All content original. Stat hints name SRD 5.2 creatures so
// `srd_get` / `monsters_elevate` can arm a scene without conversion.

export const hollowVale = {
  id: 'hollow-vale',
  name: 'The Hollow Vale',
  setting: 'The Hollow Vale',
  tagline: 'A valley that closed over its grief like a hand — where every monster was a neighbour first, and every door out is a kindness someone must perform.',
  levelBand: '1-8 across the domains; the mist arc closes at 8-10.',
  pitch: 'The mist came up one autumn and the road out stopped arriving anywhere. Inside: four parishes of a valley that used to be ordinary, each curdled around one person\'s unbearable grief — the baker who lost her family to a locked granary, the chandler who could not stop one death, the warden who hanged the wrong man, the soldier who kept an inn instead of a promise. The Vale feeds on the grief and keeps the griever, and the domains repeat their worst year on a loop that almost nobody notices. Almost. Lately the loops are stuttering: a chair stays empty a full day in Bramblefell, a candle in the Chandlery burns backward, and at the Last Inn a room has appeared upstairs with a door that was never built — and morning light under it.',
  tone: ['hearth-lit dread', 'kindness with teeth', 'autumn that will not end', 'grief worn as routine'],
  themes: [
    'grief as geography — every domain is one person\'s worst year, walkable',
    'the monster as neighbour — horror you owe a casserole to',
    'redemption as mechanism — the doors out are moral acts, not map exits'
  ],
  truths: [
    'The mist is a wall. Walk into it and you arrive back, gently, from the other side of the domain you left. The Vale does not punish attempts; it declines them.',
    'Each domain repeats its year. Locals do not notice the loop; visitors do, which makes visitors precious, suspect and hunted-for in equal measure.',
    'The Darklords were people first, and are people still. Each is fed by the Vale and held by it; each has a redemption the Vale prices as high as it can.',
    'Doors out exist. Every domain has one, and it is never a place — it is an act. The Vale keeps this fact quieter than any of its monsters.'
  ],

  gettingStarted: {
    startingLocation: 'the-last-inn',
    openers: [
      {
        id: 'the-room-that-was-never-built',
        title: 'The Room That Was Never Built',
        hook: 'The party arrives at the Last Inn — everyone arrives at the Last Inn; it is what the Inn is for — and Halberd June rents them the new room upstairs. There are eleven rooms. There have always been ten. Under the twelfth door: morning light, in a valley where the sun has not properly risen in anyone\'s memory.',
        firstScene: 'The corridor outside room eleven-and-one. June, at the party\'s shoulder, keys in hand, saying the sentence she has said to no other guest: "It only appeared after you wrote your names in the book."'
      },
      {
        id: 'the-empty-chair',
        title: 'The Empty Chair',
        hook: 'In Bramblefell, a chair at Maren Ovenwarm\'s table stood empty from dawn to dusk — the first empty chair in the domain\'s remembered history — and the briar spent the whole day growing INWARD, away from the village. The hedge-shepherds want to know who the chair belonged to. So, with bread cooling on the sill and a smile that does not reach her flour-grey eyes, does Maren.',
        firstScene: 'Bramblefell green at second breakfast. The empty chair is still empty. A shepherd\'s crook leans against it, left as a marker, and the crook has begun, very slowly, to bloom.'
      },
      {
        id: 'the-backward-candle',
        title: 'The Backward Candle',
        hook: 'Father Wick\'s parish burns a candle for every soul in the Vale, and the candles burn down as lives burn on. One candle has begun burning UP — wax rising, wick lengthening, flame growing younger. The moth-sexton smuggled it out under her coat and wants it read by someone the Chandlery cannot punish: whose life is running backward, and what happens when the candle reaches the height it was on the day the mist rose?',
        firstScene: 'A lean-to behind Millwrack\'s dead waterwheel. The sexton unwraps the candle. In its flame, faint but improving, the reflection of a road — and on the road, walking toward the viewer, somebody who left.'
      }
    ]
  },

  timeline: [
    { year: 'The Year of Plenty', event: 'The valley\'s last ordinary year: four parishes, one road, a good harvest, a garrison of one. Every domain\'s loop is a bent copy of a season from this year.' },
    { year: 'The Famine Winter', event: 'The granary lock, the empty chairs, the deaths that made the grief. Maren\'s family. Wick\'s parishioner. Mosswell\'s gallows. June\'s unkept promise. The Vale\'s four cornerstones, laid in one winter.' },
    { year: 'The Autumn the Mist Rose', event: 'The road out stopped arriving. The sun went to pewter. The valley closed over its grief like a hand closing over a coal.' },
    { year: 'The Quiet Years', event: 'The loops settle. The domains learn their shapes. The Last Inn appears at the crossroads — nobody remembers it being built, and nobody can imagine the Vale without it, which is true of everything here.' },
    { year: 'The Year of Visitors', event: 'The mist begins letting travellers IN. The Vale has learned that grief loops need witnesses the way fires need air.' },
    { year: 'Now', event: 'The loops stutter. A chair stands empty; a candle burns backward; a twelfth door grows morning light. The Vale is either weakening — or making room.' }
  ],

  regions: {
    'the-last-inn': {
      name: 'The Last Inn',
      summary: 'The crossroads inn at the Vale\'s heart and its only neutral ground: every road in the valley ends here eventually, every faction keeps a table, and the house rule — no harm under this roof — is enforced by the building itself. Halberd June keeps the bar, the book and the peace.',
      travel: 'All roads. That is the point of it. A day\'s walk to any domain; the mist never interferes with a journey that ends at the Inn.',
      sites: [
        { name: 'The Common Room', description: 'Four faction tables, one guest book, a fire that has not gone out since the mist rose. Writing your name in the book is what makes you a guest; guests are safe; the book decides nothing else, whatever the rumours say.' },
        { name: 'The Eleven Rooms', description: 'Ten rooms that have always been there, and room eleven-and-one, which appeared with the party\'s names. Its door shows morning light at the sill and does not open. Yet.' },
        { name: 'The Stable of Stayed Horses', description: 'Every horse that ever arrived is still here, content, unaging. June feeds them all. She will not discuss the arithmetic of hay.' }
      ],
      hooks: [
        'A guest\'s name has faded from the book overnight — and so has every memory of him, except the party\'s and June\'s.',
        'The Waking Few want to hold a full moot at the Inn, all four domains at one table, and need guarantors the factions haven\'t already priced: the party.',
        'Something knocked on the twelfth door last night. From the other side. June has started polishing glasses that are already clean.'
      ],
      npcs: ['halberd-june', 'crumb'],
      gm: {
        secret: 'The Inn is June\'s domain — her loop, her unkept promise made architecture. She swore to a dying comrade she would "keep a light and a door for everyone who comes after", and the Vale took her at her word: the Inn is the promise, kept perfectly, forever, INSTEAD of the one thing she actually promised to do — go home and tell his family. The twelfth room appeared because the party\'s arrival made going home conceivable again. The morning light under the door is real. It is the Vale\'s one honest exit, and it opens for June, and June cannot open it without closing the Inn.'
      }
    },
    bramblefell: {
      name: 'Bramblefell',
      summary: 'The first village, swallowed hedge by hedge: briar-farmland where the lanes rearrange overnight and the bread is famous. Maren Ovenwarm bakes for a full table, and the table is always full, and one bite makes you want nothing so much as to stay.',
      travel: 'A day from the Inn through lanes the briar edits nightly. Hedge-shepherds guide honest traffic; the briar guides the other kind, in circles, forever politely.',
      sites: [
        { name: 'Bramblefell Green', description: 'The long table under the oak, laid for the whole village at every meal. Attendance is not compulsory. Absence, however, is catered — your plate is filled, your chair is turned, and everyone is so glad when you\'re back.' },
        { name: 'The Ovenhouse', description: 'Maren\'s bakery, warm at all hours, smelling of the best year of everyone\'s childhood. The oven predates the mist. The briar grows out of its foundations, not toward them.' },
        { name: 'The Locked Granary', description: 'Preserved exactly as it was the famine winter, lock and all. The briar will not touch it. Nobody speaks of it, and the village\'s whole loop bends around not-speaking-of-it like water around a stone.' }
      ],
      hooks: [
        'The empty chair (see the opener) — and the blooming crook that marked it.',
        'A hedge-shepherd offers to trade the party a "true lane" out of the domain for a favour: carry a slice of Maren\'s bread out of Bramblefell and see if it survives the crossing. The shepherds have theories they cannot test themselves; they can no longer leave.',
        'Maren has invited the party to the head of the table. Locals go pale: the head seats have been empty since the famine winter. She is either honouring the party or replacing her family, and the difference is the whole domain.'
      ],
      npcs: ['maren-ovenwarm', 'the-boy-who-refused'],
      gm: {
        secret: 'The bread is love with the crusts cut off: one bite binds you gently into the table\'s loop (WIS save vs a warm reluctance to leave, renewed each meal — never compulsion, always invitation, which is worse). The redemption is canon: someone must refuse the bread, KINDLY, and stay anyway — prove to Maren that a chair can empty and refill, that leaving is not dying. The Boy Who Refused is the domain\'s living proof-in-progress, and Maren cannot look at him.'
      }
    },
    'the-chandlery': {
      name: 'The Chandlery',
      summary: 'Father Wick\'s parish: a candle-town where every soul in the Vale has a taper burning in the long nave, and the chandler-priest reads lives in wax. Comfort is the local industry — grief candles, memory candles, candles against the dark. All of them work. That is the problem.',
      travel: 'A day from the Inn along the Wax Road, lit end to end. Travellers are welcome; departures are noted; the light is very good and sees everything.',
      sites: [
        { name: 'The Long Nave', description: 'Thousands of lit tapers, one per soul, tended day and night. Your candle\'s height is your health, its steadiness your conscience, its colour your secrets — and Father Wick reads them all, for your own good.' },
        { name: 'The Memory Vats', description: 'Where the wax is made. The parish tithe is not money. Parishioners pour in an afternoon they can spare — a dull Tuesday, a painful anniversary — and the vats render it into wax that burns warm and forgiving.' },
        { name: 'Millwrack', description: 'The drowned mill-hamlet at the parish edge, dead waterwheel and all: the one place in the domain with no candles. The moth-sexton lives here, among the unrecorded.' }
      ],
      hooks: [
        'The backward candle (see the opener).',
        'A parishioner\'s taper shows a colour Wick has no name for, and he is uncharacteristically frightened — frightened enough to ask outsiders instead of reading deeper himself.',
        'The Memory Vats are running rich: someone is tithing memories they cannot afford, whole years at a time, and coming out of the nave lighter and simpler and smiling. The Waking Few call it the gentlest atrocity in the Vale.'
      ],
      npcs: ['father-wick', 'the-moth-sexton'],
      gm: {
        secret: 'Wick\'s loop is the death he could not prevent: a parishioner who hid her illness from him, whose candle he read too late. Now he reads everyone, always, and the parish lives in perfect lit surveillance so that NO ONE can ever hide a guttering again. The tithe-wax is the engine: comfort made from surrendered memory, and the surrendered memories are what keep the loop\'s subjects docile. His redemption: he must let one candle burn unread — grant one person the dignity of a private flame — and sit with not knowing. The backward candle is the Vale pricing that redemption: it is HERS, the parishioner he failed, her life un-burning toward the day he could have asked, and the domain will break — one way or the other — when it reaches full height.'
      }
    },
    hushwood: {
      name: 'Hushwood',
      summary: 'The gallows forest: old timber, older quiet, and Warden Mosswell\'s law. Sound behaves strangely under the canopy — guilt is audible here, footsteps confess, and the trees lean in to listen. The Vale\'s prison district, staffed by one warden and everyone\'s conscience.',
      travel: 'A day from the Inn, and the only domain the mist actively funnels people INTO: the Vale sends its accused here. The paths are clear, straight and impossible to leave without the Warden\'s leave — or a verdict.',
      sites: [
        { name: 'The Gallows Oak', description: 'The tree at the wood\'s heart, rope still hanging, knot untouched since the famine winter. Nothing has been hanged from it since. Everything in the domain is arranged so that nothing ever need be again.' },
        { name: 'The Warden\'s Walk', description: 'Mosswell\'s endless patrol-circuit, boots worn into the loam a foot deep. He walks it every hour of every day of the loop. Walking beside him is legal testimony; the wood transcribes.' },
        { name: 'The Hush', description: 'The forest\'s deep interior, where sound stops entirely. The accused who choose trial-by-silence walk in; the innocent walk out; the guilty are still in there, standing among the trees, and the trees are getting harder to count.' }
      ],
      hooks: [
        'The mist delivers an accused to the wood\'s edge with the party — a Bramblefell shepherd charged with "helping someone leave". The Vale considers that a crime. The party is invited, by the wood itself, to speak for the defence.',
        'Mosswell\'s walk has developed a stutter: one stretch of the circuit he now crosses at a run, eyes down. The Waking Few will pay in true lanes to know what has changed on that stretch.',
        'A tree in the Hush has begun to weep sap the colour of old rope, and the wood\'s silence around it has a shape — like a held breath, or an appeal.'
      ],
      npcs: ['warden-mosswell', 'the-advocate-of-leaves'],
      gm: {
        secret: 'Mosswell hanged the wrong man the famine winter — the granary lock\'s true keeper confessed years later, safely, smugly, beyond reach — and the Warden\'s loop is a justice system built to make his error impossible: infinite process, audible guilt, and a gallows that must never be used again. The weeping tree IS the hanged man, grown into the wood like all the Hush\'s guilty — except he was innocent, and the wood knows it, and the wood has been waiting decades for someone to hold the trial the Vale never allowed: the trial of Warden Mosswell, with the Warden consenting. His redemption is to stand in his own dock and accept a verdict he does not control.'
      }
    }
  },

  factions: {
    'the-vale-itself': {
      name: 'The Vale Itself',
      publicFace: 'Not spoken of as a faction, because it is spoken of as weather: the mist, the loops, the briar\'s opinions, the wood\'s hearing, the Inn\'s house rule. Everything ambient that has a preference. Locals say "the Vale provides" in the exact tone other lands say "mind the ice".',
      goals: 'Keep its people. Keep its griefs warm. Keep the loops fed with witnesses. Above all: never, ever be left.',
      methods: 'Geography, hospitality, repetition, and the patient conversion of every escape into a reason to stay. The Vale does not fight; it accommodates, until the accommodation is the cage.',
      relations: {
        'the-waking-few': 'Prey and irritant — the Vale mislays their maps, loops their meetings, and has never once harmed one, which the Few find far more sinister than malice.',
        'the-hedge-shepherds': 'Its gardeners and first compromise: the Vale lets them keep true lanes because tended grief lasts longer than wild.',
        'the-book-and-candle': 'Its favoured instruments — comfort and record, the two things that make a loop liveable, offered in perfect sincerity by its two most devoted prisoners.'
      },
      gm: {
        secret: 'The Vale is the first Darklord. It was a place that loved its people through a famine winter and could not bear the leaving-after — the funerals, the emigrations, the road out busy with wagons. Its grief is ABANDONMENT, and the mist is that grief made policy. Like every Darklord, it has a redemption with a door: it must let someone it loves leave, freely and blessed, and find that it survives the empty chair. The stuttering loops mean it has begun, unbearably, to consider this. The party\'s arrival is not an accident; the Vale collects potential witnesses for the hardest thing it will ever do.',
        weakness: 'It cannot take back a genuine blessing. Anything the Vale sincerely releases — a guest, a grief, a Darklord it forgives — stays released. Every domain\'s redemption is therefore also a wound in the wall, and four healed griefs would leave the mist nothing to be made of.'
      }
    },
    'the-waking-few': {
      name: 'The Waking Few',
      publicFace: 'The ones who noticed. A scattered fellowship of locals and stranded travellers who can see the loops, meeting in moving safehouses, mapping the repetitions, passing warnings in loop-proof mnemonic verse. Part resistance, part support group, entirely exhausted.',
      goals: 'Stay awake. Wake others gently (waking someone roughly breaks them). Find the doors out — they are certain the doors exist — and hold a full four-domain moot before the Vale loops it away.',
      methods: 'Verse-memory, chalk signs the mist cannot quite erase, favour-trading with the shepherds, and the discipline of writing everything down twice in two places.',
      relations: {
        'the-vale-itself': 'The enemy, insofar as weather can be an enemy. The Few\'s realists note the Vale has never harmed them and draw grim conclusions about being load-bearing.',
        'the-hedge-shepherds': 'Uneasy trade: true lanes for waking-verse. Neither side says allies; both sides show up.',
        'the-book-and-candle': 'Schism material. Half the Few call June and Wick the Vale\'s wardens; the other half call them its hostages, and the moot agenda\'s first item is which.'
      },
      gm: {
        secret: 'The Few\'s founder — the author of the waking-verse everyone still recites — walked into the mist eleven years ago and DID NOT come back, the only person ever not to. The Few teach it as martyrdom. The truth: she found the Inn\'s twelfth door before it was a door, was offered her own exit, and took it — alone. The verse\'s last stanza, which the Few think is corrupted, is her apology. Anyone who reconstructs it learns the doors are personal, priced, and real — and that the founder\'s door closed behind her because she would not pay hers forward.',
        weakness: 'Waking is load-bearing: the Few\'s sight depends on staying griefless enough to see the loops from outside. Give one of them a domain-shaped grief — an empty chair of their own — and the Vale can fold them in overnight. The factions know it. The Few know they know.'
      }
    },
    'the-hedge-shepherds': {
      name: 'The Hedge-Shepherds',
      publicFace: 'The briar\'s keepers: crook-carrying wardens of the lanes who guide honest traffic, prune the hedge\'s worst tempers, and know every true lane in the valley. Gruff, reliable, and paid in favours because the Vale has no coin worth minting.',
      goals: 'Keep the lanes passable, the flocks findable and the briar civil. Quietly: test, one favour at a time, whether ANYTHING can be carried out of a domain unchanged.',
      methods: 'Crooks (the briar respects a shepherd\'s crook the way courts respect a writ), lane-craft, favour-ledgers kept in knotted cord, and generations of applied hedge-psychology.',
      relations: {
        'the-vale-itself': 'The oldest bargain: the shepherds tend, the briar permits. Both sides honour it; neither trusts it.',
        'the-waking-few': 'Customers and cousins. The shepherds cannot leave — the bargain binds them valley-side — so the Few\'s escape research is also the shepherds\' proxy war.',
        'the-book-and-candle': 'Professional respect for June (neutral ground needs lanes); polite avoidance of Wick (a shepherd\'s life does not bear reading).'
      },
      gm: {
        secret: 'The blooming crook at Bramblefell\'s empty chair is the shepherds\' doing: they have learned that a crook left as a marker takes root wherever the Vale\'s grip SLIPS, and they have been quietly planting markers for a decade. They possess, in knotted cord, the only map of the Vale\'s weakening — every stutter, every slip, every place the mist thinned for an hour. They have not shown the Few. The bargain binds them not to "aid a leaving", and they are litigating the knot-ledger\'s legality with the briar, clause by clause, in a negotiation older than anyone alive.',
        weakness: 'The bargain. Break it — one proven act of helping someone leave — and the briar forecloses: no true lanes, no guided traffic, and four domains\' worth of hedge with opinions and no counsel. The shepherd delivered to Hushwood (the hook) is the test case, and every crook in the valley is watching the verdict.'
      }
    },
    'the-book-and-candle': {
      name: 'The Book and Candle',
      publicFace: 'Not an organisation — an understanding. June\'s guest book and Wick\'s long nave are the Vale\'s two registries: who is here, and how they fare. Between them they feed the hungry, house the lost, comfort the grieving and misplace nobody. The Vale\'s civil society, population two, plus everyone either has ever helped — which is everyone.',
      goals: 'Nobody cold, nobody lost, nobody unrecorded. June adds: nobody harmed under a roof. Wick adds: nobody guttering unseen. Neither says: nobody LEAVING — and both notice they never say it.',
      methods: 'The book, the nave, the Wax Road\'s lights, the Inn\'s tables, and a referral network of casseroles and candles that reaches every domain daily.',
      relations: {
        'the-vale-itself': 'Instrument and hostage both (see gm). The Vale\'s two best arguments that the cage is a home.',
        'the-waking-few': 'June hides Few meetings in the Inn\'s blind spots and never asks the agenda. Wick lights candles for the Few\'s founder every year, colour: unnameable. Neither advertises this to the mist.',
        'the-hedge-shepherds': 'The supply lines of comfort run down shepherd lanes; the favour-cords between them are the thickest in the valley.'
      },
      gm: {
        secret: 'June and Wick each know what the other is — Darklords, jailers-by-kindness, load-bearing griefs — and each has spent years gently arranging the other\'s redemption while dreading their own. The backward candle in Wick\'s nave? June tithed the memory that made its wax: the morning she was given the message to carry home. The twelfth door\'s light strengthens when Wick leaves a candle unread. The Vale\'s two instruments are, in strictest secrecy, each other\'s door out — and the pack\'s quietest tragedy is that either could finish the other\'s arc tomorrow, and both keep waiting, because who would do their jobs?',
        weakness: 'Each other. Persuade either that the other\'s freedom is worth their own post standing empty, and both dominoes fall — taking two loops, two domains\' worth of comfort, and the Vale\'s best mask down with them.'
      }
    }
  },

  npcs: {
    'halberd-june': {
      name: 'Halberd June',
      pronouns: 'she/her',
      role: 'Keeper of the Last Inn; the Vale\'s neutral ground made flesh; Darklord who does not use the word.',
      location: 'the-last-inn',
      faction: 'the-book-and-candle',
      voice: 'Quartermaster\'s brevity gone warm at the edges; polishes something whenever a subject cuts close; calls everyone "trooper".',
      wants: 'Every guest fed, safe and written down. Underneath, unworded for decades: to deliver one message to one family, forty years too late.',
      fears: 'The twelfth door. Not what is behind it — she knows exactly what is behind it. That she will die having polished glasses instead of opening it.',
      statHint: 'SRD veteran (halberd on the wall is not decorative); under her roof, treat her as impossible to surprise.',
      gm: {
        secret: 'The Inn is her loop (see the region secret). The guest book is her muster-roll: she is still, in her own ledger, the sergeant bringing everyone home. The comrade\'s message she never delivered is word-perfect in her memory; she recites it to the stabled horses on bad nights.',
        leverage: 'She will break any rule she has for a guest who genuinely needs it — and the Inn\'s no-harm rule is HER rule, which means she can suspend it, which no one alive suspects.'
      }
    },
    'maren-ovenwarm': {
      name: 'Maren Ovenwarm',
      pronouns: 'she/her',
      role: 'Baker of Bramblefell; keeper of the full table; Darklord of the first domain.',
      location: 'bramblefell',
      faction: 'the-vale-itself',
      voice: 'Flour-soft, feeds you before answering, ends arguments by cutting bread — the knife-thunk is her full stop.',
      wants: 'A full table forever; no empty chair ever again; and lately, terribly, to know why the empty chair felt — for one dawn hour — like relief.',
      fears: 'The Boy Who Refused. Not anger: hope. She has caught herself setting his place with the good plate.',
      statHint: 'SRD cult-fanatic (canon), reflavoured: her "spells" are hearth-miracles; her fanatics are anyone who has eaten.',
      gm: {
        secret: 'She knows about the granary lock — whose hand turned the key the famine winter — and has protected the vale from that knowledge for forty years because the truth would hang someone the village loves. Her grief is double-loaded: the family she lost, and the mercy she has baked over daily since. Her redemption (canon) needs a kind refusal; her breaking point is the granary truth surfacing UNkindly.',
        leverage: 'One meal, freely given, no strings — she is capable of it, once, for someone who asks her to pack it FOR THE ROAD. Asking is the whole trick. Nobody has ever asked.'
      }
    },
    'the-boy-who-refused': {
      name: 'Tam, the Boy Who Refused',
      pronouns: 'he/him',
      role: 'Bramblefell\'s only unbound resident: refused the bread at nine years old, out of pure contrariness, and has stayed anyway — nineteen now, feral-polite, the domain\'s living loophole.',
      location: 'bramblefell',
      faction: null,
      voice: 'Talks around Maren the way lanes talk around the briar; chews mint constantly (his own crop; "it\'s MINE, is why").',
      wants: 'To matter the way the table matters. He refused the belonging and got the freedom, and has spent ten years learning the price of the trade.',
      fears: 'That he stayed out of spite and it curdled into love too late to count — that when the domain breaks, he will be filed with the furniture.',
      statHint: 'SRD scout; in the lanes, he simply cannot be caught by anything that runs on paths.',
      gm: {
        secret: 'His refusal-and-staying is nine-tenths of Maren\'s redemption already performed — by the wrong person. He is proof a chair can be empty of obligation and full of presence. If MAREN ever truly sees him (the good plate is the crack in the wall), the domain\'s arc completes; the Vale therefore keeps them conversationally apart with the diligence of a chaperone, and neither has noticed the twenty-year coincidence.',
        leverage: 'He knows every true lane the shepherds know, unbargained — the briar ignores him as unbound. He is the only courier in the valley the Vale cannot invoice.'
      }
    },
    'father-wick': {
      name: 'Father Wick',
      pronouns: 'he/him',
      role: 'Chandler-priest of the parish; reader of every candle; Darklord of the second domain.',
      location: 'the-chandlery',
      faction: 'the-book-and-candle',
      voice: 'Confessional-gentle, never blinks in candlelight, asks after your health in a way that makes clear he already knows.',
      wants: 'Every flame steady, every soul legible, nobody hidden, nobody lost. He would call it love. He is not entirely wrong, which is the horror.',
      fears: 'The unnameable colour in the new taper — because he recognises it: it is the colour of being read by something in turn.',
      statHint: 'SRD priest; in the nave, his divination-flavoured readings simply succeed — resisting them is a scene, not a roll.',
      gm: {
        secret: 'His loop is the parishioner he read too late (see region secret). The backward candle is hers, and he has NOT recognised it — the one flame in the vale his gift refuses to parse, because his grief is load-bearing precisely there. The moth-sexton smuggling it OUT of the nave may be the only reason it still burns.',
        leverage: 'He will trade readings for readings: bring him a truth about himself he cannot see — there is exactly one — and he will read any candle in the nave for you, including the ones the Vale prefers unread.'
      }
    },
    'the-moth-sexton': {
      name: 'The Moth-Sexton',
      pronouns: 'she/her',
      role: 'Keeper of Millwrack\'s unrecorded dead; tender of the candleless; the parish\'s shadow-clergy of one.',
      location: 'the-chandlery',
      faction: 'the-waking-few',
      voice: 'Moth-quiet, speaks in grave-side cadence even about breakfast, laughs exactly once per conversation and means it.',
      wants: 'A funeral for everyone the loops erased — the faded names, the unpersoned guests, the founder of the Few. The Vale un-records people; she keeps a cairn per name anyway.',
      fears: 'Her own candle. She has never found it in the nave. Either she has none, or Wick keeps it somewhere private, and she cannot decide which reading is worse.',
      statHint: 'SRD spy (the skill set, not the trade); moths obey her the way cats obey no one.',
      gm: {
        secret: 'Her cairns work: a name carved at Millwrack anchors its memory against the loops — she has accidentally invented loop-proof record-keeping, which makes her drowned hamlet the Vale\'s true archive and her the most strategically important person nobody watches. The faded guest from the Inn hook has a fresh cairn already.',
        leverage: 'She holds the backward candle. She will surrender it only to someone who promises the parishioner a funeral — whatever the candle turns out to be running toward.'
      }
    },
    'warden-mosswell': {
      name: 'Warden Mosswell',
      pronouns: 'he/him',
      role: 'Warden of Hushwood; the Vale\'s entire justice system; Darklord of the third domain.',
      location: 'hushwood',
      faction: 'the-vale-itself',
      voice: 'Procedural to the syllable ("state it for the wood"); removes his hat for every verdict including lunch.',
      wants: 'Process so perfect that no verdict can ever again be wrong. Infinite appeal. Eternal deliberation. The gallows-rope aging to dust unused.',
      fears: 'The stretch of the Walk he now runs past — where the weeping tree stands, and where the silence has lately begun to sound like a man clearing his throat to speak.',
      statHint: 'SRD knight (dismounted, wood-bound); within Hushwood, he cannot be lied to — the wood objects audibly.',
      gm: {
        secret: 'The wrong hanging, the true keeper\'s safe confession, the weeping tree — see the region secret. One detail more: the granary lock\'s true keeper, whose confession Mosswell received and could not act on, is a name that would detonate Bramblefell — and Maren has protected the same name for forty years for opposite reasons. The two Darklords\' griefs share a root, and neither knows the other holds half the truth.',
        leverage: 'He will grant ANY lawful request to whoever consents to serve as the wood\'s first honest advocate in decades — the defence is the office his court has never once had filled.'
      }
    },
    'the-advocate-of-leaves': {
      name: 'The Advocate of Leaves',
      pronouns: 'they/them',
      role: 'Hushwood\'s self-appointed defence counsel: a stranded traveller who took the empty office nobody would fill, and has lost every case for nine years — which is nine years more defence than the wood ever had.',
      location: 'hushwood',
      faction: 'the-waking-few',
      voice: 'Courtroom-formal fraying into gallows humour; addresses the trees as "the jury", because they are.',
      wants: 'One acquittal. One. Also, quietly: to defend the case the wood is actually waiting for — they have noticed whose trial has never been held.',
      fears: 'Winning wrongly. An acquittal argued on technique rather than truth would teach the wood that eloquence beats justice, and the wood LEARNS.',
      statHint: 'SRD noble (the statistics of someone whose weapon is procedure); grant advantage on any social roll made in genuine defence of another.',
      gm: {
        secret: 'They are the Waking Few\'s inside line to Hushwood and the founder\'s last recruit — they carry the waking-verse complete, INCLUDING the corrupted last stanza, memorised phonetically without understanding it. They are, unknowingly, the walking key to the Few\'s deepest secret, and the wood, which hears everything, has been keeping their secret for them as a professional courtesy.',
        leverage: 'File one motion for them — the trial of Warden Mosswell, defendant consenting — and they will argue any case the party ever needs argued, anywhere sound carries.'
      }
    },
    crumb: {
      name: 'Crumb',
      pronouns: 'he/him',
      role: 'The Last Inn\'s pot-boy, boot-black and self-appointed intelligence service; age somewhere between ten and the mist.',
      location: 'the-last-inn',
      faction: 'the-book-and-candle',
      voice: 'Staccato service-patter with sudden unnerving precision ("more ale? — you\'re the third table tonight what asked about the twelfth door").',
      wants: 'To be written in the guest book. June says staff don\'t sign. He has decided this means he is not fully REAL yet and is saving up deeds to qualify.',
      fears: 'That he was a guest once — that he faded like the man last week, and June kept him the only way she could: by making him staff before the book let go.',
      statHint: 'SRD commoner (child); nothing said in the common room escapes him, and the common room is where everything is eventually said.',
      gm: {
        secret: 'His fear is the truth. Crumb faded eleven years ago — the same season the Few\'s founder left — and June caught his last thread by hiring him mid-vanish; the apron is a binding. His original name is on a cairn at Millwrack that the moth-sexton cannot match to a face. Reuniting boy and name would make him real again — and would prove, publicly, that the Vale\'s erasures can be UNDONE, which changes every faction\'s arithmetic at once.',
        leverage: 'He trades in overheard everything, priced in deeds-that-count. He has heard June recite the message to the horses, word-perfect, and does not know what he is holding.'
      }
    }
  },

  secrets: [
    {
      id: 's1-the-bread-binds',
      tier: 1,
      truth: 'Maren\'s bread gently binds eaters into Bramblefell\'s table-loop — invitation renewed at every meal, never compulsion, all the harder to refuse for being sincere. The whole domain\'s attendance is one long consent nobody remembers giving.',
      breadcrumbs: [
        'Visitors who "decided to stay a few more days" using identical phrasing, down to the shrug.',
        'The hedge-shepherds\' standing offer to pay for bread carried OUT — they cannot test the crossing themselves.',
        'Tam eating his own mint, his own bread, his own everything, with the whole table\'s tolerant pity aimed at the one free man in the room.'
      ]
    },
    {
      id: 's2-the-wax-is-memory',
      tier: 1,
      truth: 'The Chandlery\'s tithe is memory: parishioners pour spare afternoons and painful anniversaries into the vats, and the rendered wax burns as comfort. The parish\'s peace is made of surrendered pasts, and the heaviest tithers are the smiling simple ones.',
      breadcrumbs: [
        'A widow who cannot remember her wedding but owns a candle that smells exactly like it.',
        'Vat-day queues of people rehearsing what they can afford to lose, like folk counting coins.',
        'Millwrack\'s candleless dead — the only souls in the Vale nobody\'s comfort was rendered from.'
      ]
    },
    {
      id: 's3-the-doors-are-deeds',
      tier: 2,
      truth: 'Every domain has a door out, and none of them are places: each is an act that heals the Darklord\'s loading grief. Refuse the bread kindly and stay; let one candle burn unread; hold the trial of the Warden; deliver June\'s message home. The Waking Few are right that the doors exist and wrong about their shape — they are searching the map for what lives in the deed.',
      breadcrumbs: [
        'The twelfth door strengthening its light on the one night Wick left a taper unread.',
        'The blooming crook: the Vale\'s grip slipping precisely where a redemption was ALMOST performed.',
        'The Few\'s corrupted last stanza, which scans perfectly if recited as an apology rather than a map.'
      ]
    },
    {
      id: 's4-the-jailers-are-prisoners',
      tier: 2,
      truth: 'The four Darklords are the Vale\'s four cornerstone griefs, recruited from its own people in one famine winter — and two of them (June and Wick) know it, know each other, and have spent years secretly arranging each other\'s redemption while dreading their own. The Vale\'s instruments of comfort are a two-person conspiracy of hoped-for escape, deadlocked by devotion to their posts.',
      breadcrumbs: [
        'The backward candle\'s wax, traceable — for anyone who asks the vat-ledger — to a single tithed memory of June\'s.',
        'Wick lighting an unnameable-coloured candle yearly for the Few\'s founder, unasked.',
        'Mosswell and Maren protecting the same forty-year-old name for opposite reasons, half a truth each.'
      ]
    },
    {
      id: 's5-the-vale-is-the-first-darklord',
      tier: 3,
      truth: 'The Vale itself is the original Darklord: a place that loved its people and could not survive the leaving-after the famine winter, whose grief — abandonment — became the mist. It has the same anatomy as its children: a loop (the eternal autumn), a feeding (the witnessed griefs), and a redemption with a door — it must bless a true leaving and survive the empty chair. The stuttering loops, the admitted visitors, the twelfth room: the Vale is trying to learn how. Every healed domain thins the mist; four healed griefs would leave it nothing to be made of but its own — and the pack takes no stance on whether the party ends the Vale, redeems it, or teaches it, chair by chair, that love and open doors can coexist.',
      breadcrumbs: [
        'The mist declining escapes GENTLY — grief\'s refusal, not a jailer\'s: it cannot bear the leaving, so it un-happens it.',
        'The Vale collecting witnesses at the Inn like a patient gathering family before hard news.',
        'Every domain\'s loop bending around a famine-winter wound — and the valley\'s own wound, the road out, being exactly where the mist stands thickest.',
        'The horses. Content, unaging, all still here: the Vale keeping every single thing that ever tried to carry someone away, and keeping them KINDLY.'
      ]
    }
  ],

  pantheon: {
    note: 'The Vale\'s gods did not die of the mist — they were grieved to death before it rose, in the famine winter, when prayer after prayer went unanswered until the praying stopped. What follows is estate: what each left in the valley, and who tends the remainder. Clerics fit as tenders of these remains; reflavour any SRD domain as hearth-rite, wax-craft, verdict-keeping or road-blessing.',
    deadGods: [
      { name: 'The Full Hand, the Harvest-Mother', domain: 'plenty, hospitality, the laden table', whatRemains: 'Bramblefell\'s long table and its terrible perfected hospitality; the good-plate custom; grace-before-meals said in a tense nobody teaches: the apologetic past.' },
      { name: 'The Lantern-Warden', domain: 'guidance, thresholds, the light left burning', whatRemains: 'The Inn\'s undying fire, the Wax Road, and the custom of a lamp in the window for travellers — kept valley-wide, fiercely, by people who no longer remember whom the light is for.' },
      { name: 'The Even Scale', domain: 'justice, oaths, the measured verdict', whatRemains: 'Hushwood\'s audible conscience — the wood is his grown-wild remainder — and the removed-hat custom at verdicts, which was his rite before it was Mosswell\'s tic.' },
      { name: 'The Walker-Out, god of departures', domain: 'roads, farewells, the blessed leaving', whatRemains: 'Almost nothing — the mist ate his whole portfolio first. What survives: the phrase "go well", said at partings with inexplicable weight, and one overgrown roadside shrine at the valley\'s mouth that the briar, alone in all its opinions, refuses to touch.' }
    ]
  },

  runningNotes: [
    'Run the loops as texture before ever naming them: the same cart mended twice, the same argument word for word, second helpings at the exact same bell. Let a player say "wait — didn\'t this happen?" before any NPC confirms it.',
    'Reveal by ladder: tier-1 makes the Vale sinister but survivable (the bread, the wax). Tier-2 turns jailers into hostages and doors into deeds. Hold tier-3 until the players themselves start treating the VALLEY as a character with feelings — it is, and it is listening.',
    'Horror register: never gore, always warmth-with-teeth. The scary sentence is not "it attacks" but "it has already set a place for you."',
    'The Darklords are redeemable, not beatable: stat blocks exist for the sessions where players insist, but every combat "victory" resets the loop harder. The doors are deeds; make the deeds cost something real from the party, not just from the NPCs.',
    'Ending stance: none taken. Four healed griefs and a dissolved mist, a redeemed Vale that keeps its people by choice, a bargained equilibrium, or the party simply taking the twelfth door and living with the leaving — prep consequences, not a canon. The one fixed point: anything the Vale sincerely blesses stays free.'
  ]
};
