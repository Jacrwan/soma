// --- More story for Epoch ---------------------------------------------------------
// Plain data only. Lines are [speaker, text] pairs, the same shape as LORE in
// sim.js. Speakers: 'owl', 'pro' (the Procrastinator), or a villager's
// lowercase name ('mira', 'tobin', ...).

// --- Atlas pages ------------------------------------------------------------------
// One page per landmark id in country.js LANDMARKS, shown when the landmark is
// first found. Read in order, each land tells a bit of how the world forgot.
export const ATLAS_PAGES = {
  // Land 1: Stone Age (Chapter 1: Waking)
  mammoth: "Page one. The first people learned the herds by watching them. They wrote nothing down, so they had to remember everything.",
  cave: "When remembering got too heavy, someone painted it on a wall. That was the first page of the Atlas, before it was even a book.",
  eldertree: "The elder tree was planted by the first keeper. Every ring is a year somebody chose to learn one more thing.",
  sunstones: "These stones count the days to summer. The first deadline, if you like. People met it, and nobody went hungry.",

  // Land 2: Bronze Age (Chapter 2: The Library Burns)
  port: "Boats carried copper up the river, and stories came with them. The library was built to keep the stories dry.",
  obelisk: "Students carved their names here after their final trials. Some names are cut deep. Some were added years late, and still count.",
  caravan: "Traders swapped lessons at every stop. A fair price for a lesson was another lesson. The Atlas grew a page a night.",
  sandarch: "The wind cut this arch a grain at a time. The Librarian wrote beside it: \"That is how you read a hard book.\"",

  // Land 3: Middle Ages
  castle: "The lord of this keep put everything off until spring. Spring came. So did the Drift. Only the stairs are left.",
  joust: "Knights trained here every morning, mostly by falling off. The Atlas has a whole chapter on falling off and getting back on.",
  fishing: "The old fisher here taught that a slow day is still a day on the water. The page smells faintly of trout.",
  mill: "The mill never stopped, not even in the dark years. Small turns, every day. The town ate because of it.",

  // Land 4: Age of Steam
  mine: "Miners worked by lamplight and sang to keep count. The Drift hates singing. Nobody knows why. The Librarian has guesses.",
  watertower: "The engines ran on water and patience. When the tower ran dry, the whole town stopped and filled it bucket by bucket.",
  chimney: "The first factory burned the night shift into the morning shift, again and again. The workers wrote: rest is part of the work.",
  engine: "This engine pulled the first train in, three days late. The town cheered anyway. Late still arrives.",

  // Land 5: Modern Age
  lighthouse: "The keeper of this light never knew who she saved. She lit it every night regardless. That is most of teaching.",
  turbine: "On a windy day it powers half the town. On a still day it waits. Both are allowed.",
  mast: "The station plays music all night for anyone still studying. The last request in the log just says: \"almost done\".",
  billboard: "Nobody remembers what it sold. The Atlas notes only that it said \"Buy now, think later\". The Procrastinator owned the company.",

  // Land 6: Space Age
  radar: "The dish listens for anyone, anywhere, who is learning something right now. It has never once been quiet.",
  satellite: "It fell in a storm of sparks, still carrying a copy of the whole Atlas. The pages you found were the backup.",
  launch: "Most rockets here exploded. Each one has a page explaining why. The last one did not explode.",
  observatory: "The final page. The Atlas was never finished, and never will be. Someone always has one more thing to learn.",
};

// --- Villager stories ---------------------------------------------------------------
// Three beats each, unlocked as friendship (person.friend, 0 to 100) passes
// `at`. Show a beat once, the next time the player talks to that villager.
export const VILLAGER_STORIES = {
  Mira: [
    { at: 20, lines: [
      ['mira', "My sister used to gather herbs with me. She left the town last spring."],
      ['mira', "Said the work stopped making sense. I didn't argue. I wish I had asked more questions."],
    ] },
    { at: 50, lines: [
      ['mira', "Got a letter from her today. She works at a tea house by the coast now."],
      ['mira', "She sounds happy. Happier than when she was here, cramming plant names at midnight."],
      ['mira', "Leaving wasn't failing, for her. It just took me a while to see it."],
    ] },
    { at: 80, lines: [
      ['mira', "She's thinking of coming back. Not to stay. Just to learn the parts she actually liked."],
      ['mira', "Doors stay open longer than people think. Remember that, keeper."],
    ] },
  ],
  Tobin: [
    { at: 20, lines: [
      ['tobin', "Want to know a secret? I failed the smith's trial. First try. Cracked the blade in front of everyone."],
      ['tobin', "Went home and didn't touch a hammer for a month."],
    ] },
    { at: 50, lines: [
      ['tobin', "Second try, I practiced the boring parts. Heating. Waiting. Heating again."],
      ['tobin', "Turns out the boring parts were the whole trial. Who knew."],
    ] },
    { at: 80, lines: [
      ['tobin', "I keep that cracked blade over my door. People think it's a mistake I'm hiding."],
      ['tobin', "It's not hiding. It's the reason I'm any good. Your bad grades can be that too."],
    ] },
  ],
  Odo: [
    { at: 20, lines: [
      ['odo', "I once read for nineteen days straight. Very impressive. Do not do it."],
      ['odo', "By day twenty I couldn't remember my own name. I signed a letter \"Scholar\"."],
    ] },
    { at: 50, lines: [
      ['odo', "The Librarian found me asleep on a stack of books and made me take a walk. I was furious."],
      ['owl', "He was. He also came back and finished the chapter in an hour."],
      ['odo', "Rest is not the opposite of study. It's the part where the study sticks."],
    ] },
    { at: 80, lines: [
      ['odo', "These days I stop at sunset. I learn less per day and far more per year."],
      ['odo', "If you're tired, keeper, go be tired somewhere nice. The books will wait. They're books."],
    ] },
  ],
  Wren: [
    { at: 20, lines: [
      ['wren', "I've been writing the same song for three years. It's almost perfect."],
      ['wren', "Nobody's heard it. It's not ready. It's never quite ready."],
    ] },
    { at: 50, lines: [
      ['wren', "The Procrastinator told me once that an unfinished song can't be bad. I liked that a lot."],
      ['wren', "Then I realized an unfinished song can't be good either. It just sits there."],
    ] },
    { at: 80, lines: [
      ['wren', "I played it at the tavern last night. Messed up the second verse. Twice."],
      ['wren', "Everyone sang along anyway. Done is a kind of beautiful, it turns out."],
    ] },
  ],
  Bram: [
    { at: 20, lines: [
      ['bram', "I took the captain's exam two weeks ago. Results come by raven."],
      ['bram', "I check the sky every hour. The ravens have started to look at me funny."],
    ] },
    { at: 50, lines: [
      ['bram', "Still no raven. I've rewritten every answer in my head a hundred times."],
      ['bram', "Odo says the test is over and my worrying can't change a single mark. Rude. Correct, but rude."],
    ] },
    { at: 80, lines: [
      ['bram', "Raven came. I passed. Barely. I'm framing it."],
      ['bram', "Funny thing. The waiting was worse than the exam. Next time I'll spend it fishing with Fen."],
    ] },
  ],
  Juna: [
    { at: 20, lines: [
      ['juna', "Bakers start at three in the morning. For years I just never went to sleep at all."],
      ['juna', "The bread was fine. I was not."],
    ] },
    { at: 50, lines: [
      ['juna', "Dough has to rest, or it tears. Took me twenty years to learn that about me."],
    ] },
    { at: 80, lines: [
      ['juna', "I sleep now. Early bed, early oven. The bread's better, somehow."],
      ['juna', "Here. A loaf for every all-nighter you don't pull. Deal?"],
    ] },
  ],
  Pell: [
    { at: 20, lines: [
      ['pell', "Dace and I planted this field together. He dropped out of the farm school halfway through."],
      ['pell', "I finished. Most days I still plant his rows the way he liked them."],
    ] },
    { at: 50, lines: [
      ['pell', "Everyone said he gave up. He didn't. He was carrying his whole family's harvest that year."],
      ['pell', "Some people quit. Some people are just carrying something you can't see."],
    ] },
    { at: 80, lines: [
      ['pell', "Dace wrote. He's taking one class at a time now, at night. Slow, he says."],
      ['pell', "Slow still gets the field planted. I told him I'd save him a row."],
    ] },
  ],
  Sela: [
    { at: 20, lines: [
      ['sela', "I made a deal with the Procrastinator once. He sold me a week. Free, he said."],
      ['sela', "I spent the whole week not doing my ledgers and feeling great about it."],
    ] },
    { at: 50, lines: [
      ['sela', "The bill came the next week. All seven days of ledgers, plus the new ones. Interest, he called it."],
      ['pro', "I did say free. I never said cheap."],
    ] },
    { at: 80, lines: [
      ['sela', "I still like him, honestly. Charming man. Terrible accountant."],
      ['sela', "Now I do one page of ledgers before lunch. He hasn't made a sale here in months."],
    ] },
  ],
  Ivy: [
    { at: 20, lines: [
      ['ivy', "My roses bloomed late this year. Everyone else's were out a month ago."],
      ['ivy', "I almost dug them up. Thought something was wrong with them."],
    ] },
    { at: 50, lines: [
      ['ivy', "I used to compare my grades to my cousin's. She was always a month ahead."],
      ['ivy', "Different soil, different sun. Comparing just made me water everything wrong."],
    ] },
    { at: 80, lines: [
      ['ivy', "The late roses are the best ones in town now. Nobody asks when they bloomed."],
      ['ivy', "Grow at your speed, keeper. The garden doesn't keep score. Well. I do. But kindly."],
    ] },
  ],
  Rook: [
    { at: 20, lines: [
      ['rook', "Last group build, I did the walls, the roof, and the door. Three other builders signed it."],
      ['rook', "Didn't say a word. Just stewed for a month."],
    ] },
    { at: 50, lines: [
      ['rook', "Turns out one of them thought I didn't want help. I never asked for any. So."],
      ['rook', "Asking is a tool too. I just never kept it in my belt."],
    ] },
    { at: 80, lines: [
      ['rook', "New rule: first day of any job, everyone picks a wall out loud. Works great."],
      ['rook', "If you're stuck on something, ask somebody. It's not cheating. It's building."],
    ] },
  ],
  Nell: [
    { at: 20, lines: [
      ['nell', "I was the Librarian's apprentice at the old library. I was there the night it burned."],
      ['nell', "I ran out with one book. Not even a good one. A dictionary."],
    ] },
    { at: 50, lines: [
      ['nell', "For years I thought I wasn't a real librarian. Real ones would have saved more."],
      ['owl', "Nell. You saved every word. That's literally what a dictionary is."],
      ['nell', "...I hate when you're right."],
    ] },
    { at: 80, lines: [
      ['nell', "I'm rebuilding the shelves page by page, as you find them. It's slow. I like slow now."],
      ['nell', "If you ever feel like you don't belong in your class, keeper, I promise you're not the only one."],
    ] },
  ],
  Fen: [
    { at: 20, lines: [
      ['fen', "Fishing's mostly waiting. Like waiting for a grade, except the fish don't post them online."],
    ] },
    { at: 50, lines: [
      ['fen', "Lost the biggest fish of my life last spring. Line snapped. I sulked for a week."],
      ['fen', "Then I went back out. You can't catch anything while you're sulking on the shore."],
    ] },
    { at: 80, lines: [
      ['fen', "One bad catch doesn't make you a bad fisher. One bad grade doesn't either."],
      ['fen', "Cast again tomorrow. I'll save you the good spot."],
    ] },
  ],
};

// --- Story beats ------------------------------------------------------------------
// Extra moments, same shape as LORE in sim.js. Each fires once (mark it seen
// the way storyBeat() does). The comment above each says when.
export const BEATS = {
  // When the first study session finishes (any length, timer completes).
  firstStudy: [
    ['owl', "There. Did you see that? The fog pulled back a step."],
    ['owl', "That's how it works. Every minute you study, the Drift loses a little ground."],
    ['owl', "Not glamorous. Just true. Have a stretch, keeper. You earned it."],
  ],

  // When the first exam (kind 'boss') is beaten at the gate on exam day.
  firstExam: [
    ['owl', "The Examiner's down! The gate held!"],
    ['pro', "Hm. Lucky. Beginner's luck. Definitely luck."],
    ['owl', "It wasn't luck. It was every session you sat through when you'd rather not have."],
    ['owl', "Whatever the grade says, you showed up ready. Remember how this feels."],
  ],

  // When the first week goal is cleared (claimWeek returns a chest for the first time).
  firstWeek: [
    ['owl', "A whole week, done. Every hour studied, everything handed in."],
    ['owl', "Back when the library stood, we'd ring a bell for this. Imagine a bell."],
    ['pro', "I'm imagining a nap. Same energy."],
    ['owl', "Monday brings a new goal. It always will. But this week is yours forever."],
  ],

  // When the study streak (state.study.streak) first reaches 7 days.
  streak7: [
    ['owl', "Seven days in a row. Do you know what the town calls that?"],
    ['owl', "A habit. The Drift can't eat a habit. It's tried."],
    ['owl', "And if you miss a day someday, that's fine. Habits come back faster than they leave."],
  ],

  // The first time nothing is due-and-unsubmitted (every current homework item handed in).
  allHandedIn: [
    ['owl', "Listen. Hear that? Nothing stomping around town."],
    ['owl', "Every assignment handed in. The roads are quiet for the first time since you woke."],
    ['pro', "Ugh. It's so peaceful. I hate it. I'll be in my fog if anyone needs me."],
  ],

  // When the player opens the game after 3+ days away. Gentle: no guilt, no lecture.
  // Can fire again on later long absences (use a fresh id per return if wanted).
  welcomeBack: [
    ['owl', "There you are! I saved you a seat by the fire."],
    ['owl', "Life gets big sometimes. The town understands. So do I."],
    ['owl', "A few monsters wandered in while you were out. Nothing we can't handle together."],
    ['owl', "No rush. Pick one small thing, and we'll start there."],
  ],

  // When the first mythic chest is opened (chest.rarity === 'mythic').
  firstMythic: [
    ['owl', "Oh. Oh my. That's a mythic chest. I've only read about these."],
    ['owl', "They say the old keepers filled them for whoever came after. Twelve weeks of work, sealed in one box."],
    ['pro', "Can I just... hold it? For a second? I'll give it back later."],
    ['owl', "No."],
  ],

  // --- The Procrastinator drops in ---------------------------------------------
  // When a study session starts after midnight (local time 0:00 to 4:00).
  proLateNight: [
    ['pro', "Studying? At this hour? Even I'm in pajamas."],
    ['pro', "Go to bed. Do it tomorrow. I mean that as a friend. A friend who also wants you to fail."],
    ['owl', "He's half right, annoyingly. Do a short one, then sleep. Tired brains forget."],
  ],

  // When an assignment is due within 24 hours and has 0% study progress / not opened.
  proDeadline: [
    ['pro', "Psst. That one's due in less than a day. Have you considered: not thinking about it?"],
    ['pro', "Look how nice the clouds are. Those clouds won't be here later. The assignment will."],
    ['owl', "Twenty minutes on it now. Just twenty. Watch how much smaller it gets."],
  ],

  // The first time any assignment goes overdue.
  proFirstLate: [
    ['pro', "Ah, my first little late one. Look at it. It grows up so fast."],
    ['pro', "Don't feel bad. Late is cozy. Late is where all my friends live."],
    ['owl', "Late is still worth handing in. Most of the points are still on the table. Go grab them."],
  ],

  // When the player hands in an assignment more than 2 days before it's due (first time).
  proEarly: [
    ['pro', "Wait. You handed it in early? On purpose?"],
    ['pro', "That's not allowed. I'm checking the rules. There must be a rule."],
    ['pro', "...There isn't a rule. Fine. Well played. I'll get you next week. Probably. Later."],
  ],
};

// --- The Procrastinator's lines ---------------------------------------------------
// One-liners homework monsters say in his voice. Plain text, no placeholders,
// so any monster can use any line.
export const PROCRASTINATOR_TAUNTS = [
  "The Procrastinator sends his love. And a reminder that tomorrow exists.",
  "Why do it now when you could feel bad about it later?",
  "Just check your phone first. I'll wait. I'm great at waiting.",
  "Tidying your desk counts as studying. Ask anyone. Ask me.",
  "Five more minutes. Then five more. That's how naps are born.",
  "Future you will handle it. Future you loves a challenge.",
  "You work better under pressure. You told me so yourself.",
  "Later is not a time. It's a lifestyle.",
  "Rest your eyes. Rest your brain. Rest your whole semester.",
  "Starting is the hardest part, so why not skip it entirely?",
  "I'm not a monster. I'm a suggestion. With teeth.",
  "Snack first. Nobody ever learned anything hungry.",
  "Make a to-do list. Admire it. That's basically doing it.",
  "The deadline is a rough guess, honestly. More of a vibe.",
  "Shh. Don't open me. Opening me makes it real.",
];
