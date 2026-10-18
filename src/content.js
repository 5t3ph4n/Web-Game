// All the people who live on the planet. Offsets are metres east/north of their place's centre.
export const NPCS = [
  // ---- Pebbleton
  {
    id: 'pip', name: 'Pip', skin: 'character-female-b', region: 'village', at: [5, -5], behavior: 'idle', pitch: 1.3,
    hi: 'Psst! Want a parasol?',
    lines: [
      "Oh! A new face! I make parasols. Well... I make ONE parasol, over and over again.",
      "Here, take this one! {Hold SPACE} while you're falling and it'll float you down nice and gently.",
      "Try it off a rooftop! ...Actually, don't tell the mayor I said that.",
    ],
    gives: 'glider',
    after: ["How's the parasol? Try jumping off Mount Hush. The view is unreal.", "I'm thinking of making a second parasol. Big step for me."],
  },
  {
    id: 'mayor', name: 'Mayor Bun', skin: 'character-male-c', region: 'village', at: [-3, 4.5], behavior: 'idle', pitch: 0.8,
    hi: 'Welcome to Pebbleton!',
    lines: [
      'Welcome to Pebbleton! Population: small. Charm: enormous.',
      "Everyone says this planet is tiny. Have they tried walking around it? I have. Took me all afternoon.",
      'If you spot any Stardrops, grab them! Legend says they fell from the sky the night the planet was born.',
      '{Press J} to check your journal. It keeps track of everywhere you\'ve been.',
    ],
  },
  {
    id: 'olive', name: 'Olive', skin: 'character-female-a', region: 'village', at: [9, 6], behavior: 'idle', pitch: 1.1,
    hi: 'Fresh bread!',
    lines: [
      "Fresh bread! ...It's imaginary bread, but it's very fresh.",
      "My cousin Daisy runs the farm down south. Tell her the windmill's squeaking again. She knows. She always knows.",
    ],
  },
  {
    id: 'theo', name: 'Theo', skin: 'character-male-d', region: 'village', at: [-6, -7], behavior: 'wander', wander: 11, pitch: 1.5,
    hi: 'Tag! You\'re it!',
    lines: [
      "Tag! You're it! ...Wait, you're not chasing me. That's not how it works.",
      'I heard there\'s a giant stone head way up north. I bet it sneezes.',
      'Did you know if you {run} you go faster? I invented that.',
    ],
  },
  {
    id: 'moss', name: 'Grandpa Moss', skin: 'character-male-a', region: 'village', at: [-8.5, 1], behavior: 'sit', pitch: 0.7,
    hi: 'Sit a while...',
    lines: [
      'Sit a while. Watch the clouds go round. They always come back, you know.',
      'Walk up to a bench and {press E} to sit down. Time flies when you sit still. Literally. Try it and watch the sun.',
      'When I was young this planet was so small you could hear your own footsteps come back around.',
    ],
  },
  {
    id: 'juniper', name: 'Juniper', skin: 'character-male-e', region: 'village', at: [3, 9], behavior: 'dance', pitch: 1.0,
    hi: '♪ ♫ ♪',
    lines: [
      "I'm writing a song about this planet. So far it's just one note. It's a REALLY good note though.",
      'The old stones up in the ruins sing when you step on them. In the right order... something wonderful happens.',
    ],
  },
  // ---- Gull Harbor
  {
    id: 'gale', name: 'Captain Gale', skin: 'character-male-f', region: 'harbor', at: [7, 1], behavior: 'idle', pitch: 0.75,
    hi: 'Ahoy there!',
    lines: [
      "Ahoy! See that little rowboat at the end of the pier? She's yours if you want her. Walk up and {press E} to hop in.",
      "Out east, past the deep water, there's an island shaped like a turtle. Or a turtle shaped like an island. Never got close enough to check.",
      '{row} {Press E} near the shore to hop out.',
    ],
  },
  {
    id: 'nell', name: 'Nell', skin: 'character-female-c', region: 'harbor', at: [-2, -6], behavior: 'idle', pitch: 1.1,
    hi: 'Shh... fish.',
    lines: ['Shh. The fish can hear you thinking.', 'The Coral Shallows up north-east is where the fish go to gossip. Bring a boat.'],
  },
  // ---- Lighthouse
  {
    id: 'wren', name: 'Keeper Wren', skin: 'character-female-d', region: 'lighthouse', at: [-4, 2], behavior: 'idle', pitch: 1.0,
    hi: 'Evening, traveller.',
    lines: [
      'Every night I light the lamp. Every morning I turn it off. It\'s a living.',
      'From the top of Mount Hush you can almost see the whole planet. Almost.',
    ],
  },
  // ---- Mirror Lake
  {
    id: 'reed', name: 'Reed', skin: 'character-male-b', region: 'lake', at: [12, 3], behavior: 'idle', pitch: 0.9,
    hi: 'So still...',
    lines: ['The lake is so still you can see two of everything. Two clouds. Two of me. It\'s a lot.', 'Swim out to the lily pads if you like. The frogs moved out years ago.'],
  },
  // ---- Whisperwood
  {
    id: 'fern', name: 'Ranger Fern', skin: 'character-female-e', region: 'forest', at: [2, 3], behavior: 'wander', wander: 14, pitch: 1.05,
    hi: 'Mind the roots!',
    lines: [
      'The Whisperwood trees whisper. Mostly gossip about squirrels.',
      'Walk up to an animal slowly and {press E} to pet it. They love a good scratch. Running scares them off!',
    ],
  },
  {
    id: 'bo', name: 'Camper Bo', skin: 'character-male-b', region: 'forest', at: [-9, -6], behavior: 'sit', pitch: 0.85,
    hi: 'Marshmallow?',
    lines: ['Marshmallow? No? More for me.', 'When it rains in the woods, the whole forest smells like a cosy sweater.'],
  },
  // ---- Glowcap Grove
  {
    id: 'spore', name: 'Spore', skin: 'character-female-f', region: 'grove', at: [-3, -9], behavior: 'dance', pitch: 1.4,
    hi: 'Boing boing!',
    lines: ['Jump on the big mushrooms! They\'re bouncy! Probably safe! Mostly!', 'At night the caps glow. That\'s how you know they\'re happy.'],
  },
  // ---- Bloom Meadow
  {
    id: 'bea', name: 'Bea', skin: 'character-female-a', region: 'meadow', at: [-6, 5], behavior: 'wander', wander: 9, pitch: 1.2,
    hi: 'Bzz!',
    lines: ['Bzz. Sorry. Occupational habit.', 'Did you see the big balloon? It flies all the way around the world and back!'],
  },
  {
    id: 'otto', name: 'Otto', skin: 'character-male-c', region: 'meadow', at: [8, -3], behavior: 'idle', pitch: 0.85,
    hi: 'All aboard!',
    lines: [
      'Step up to the basket and {press E}. Hold on to your hat!',
      'Pro tip: you can jump out mid-flight with {SPACE}. With a parasol, that\'s not even a bad idea.',
    ],
  },
  // ---- Windmill Farm
  {
    id: 'daisy', name: 'Farmer Daisy', skin: 'character-female-b', region: 'farm', at: [4, 8], behavior: 'wander', wander: 8, pitch: 1.0,
    hi: 'Mooorning!',
    lines: ['Moo— sorry. I\'ve been talking to the cows too long.', 'The windmill\'s squeaking? Tell Olive I know. I always know.'],
  },
  {
    id: 'hank', name: 'Hank', skin: 'character-male-d', region: 'farm', at: [-7, -4], behavior: 'idle', pitch: 0.8,
    hi: 'Howdy.',
    lines: ['Pumpkins don\'t grow by themselves. Well. They mostly do. I mostly watch.', 'Head further south and it gets cold. Real cold. Penguin cold.'],
  },
  // ---- Mount Hush
  {
    id: 'sumi', name: 'Sumi', skin: 'character-female-c', region: 'mountain', at: [3.5, 3.5], behavior: 'idle', pitch: 0.95,
    hi: '...',
    lines: ['Shhh... listen. Do you hear that? Silence.', 'Ring the bells if you like. The mountain enjoys a little music.', 'Open your parasol and leap. The wind up here is kind.'],
  },
  {
    id: 'kit', name: 'Climber Kit', skin: 'character-male-e', region: 'mountain', at: [-14, -12], behavior: 'idle', pitch: 1.1,
    hi: 'Phew!',
    lines: ['Halfway up! Or halfway down. Depends on your outlook.', 'If a slope is too steep, try jumping up the ledges. {Space} is your friend.'],
  },
  // ---- Sunscorch Dunes
  {
    id: 'zahra', name: 'Zahra', skin: 'character-female-d', region: 'desert', at: [-4, 6], behavior: 'wander', wander: 10, pitch: 1.0,
    hi: 'Hot one today!',
    lines: ['The dunes move a little every night. So do I.', 'Further south-east there\'s an oasis. Palm trees and the coldest water on the planet.'],
  },
  {
    id: 'dune', name: 'Professor Dune', skin: 'character-male-a', region: 'desert', at: [9, -7], behavior: 'idle', pitch: 0.8,
    hi: 'Fascinating!',
    lines: ['I\'m studying the lions. Mostly they nap. Fascinating stuff.', 'The giraffes here are very tall. I measured. They are, in fact, tall.'],
  },
  {
    id: 'mira', name: 'Mira', skin: 'character-female-f', region: 'oasis', at: [5, 4], behavior: 'sit', pitch: 1.15,
    hi: 'Ahh, shade.',
    lines: ['Shh, the water\'s sleeping.', 'I walked here from the desert. Took ages. Worth it.'],
  },
  // ---- Frostcap
  {
    id: 'olaf', name: 'Olaf', skin: 'character-male-b', region: 'frost', at: [4, -3], behavior: 'idle', pitch: 0.9,
    hi: 'Brrr!',
    lines: ['The penguins think I\'m one of them. I haven\'t had the heart to tell them.', 'It snows here all the time. Even in summer. ESPECIALLY in summer.'],
  },
  // ---- Starfall Crater
  {
    id: 'vega', name: 'Vega', skin: 'character-female-e', region: 'crater', at: [6, 18], behavior: 'idle', pitch: 1.05,
    hi: 'Look up!',
    lines: [
      'Something fell here a long, long time ago. Touch the stone in the middle. It\'s still warm.',
      'At night the sky over the crater is full of shooting stars. Bring a blanket.',
    ],
  },
  // ---- Old Ruins
  {
    id: 'pebble', name: 'Dr. Pebble', skin: 'character-male-f', region: 'ruins', at: [-8, 9], behavior: 'idle', pitch: 0.85,
    hi: 'Ancient stuff!',
    lines: [
      'These ruins are older than the planet. I\'m not sure how. I have a theory. It\'s not a good theory.',
      'The singing stones! Step on them from the lowest note to the highest and see what happens.',
    ],
  },
  // ---- Turtle Isle
  {
    id: 'lou', name: 'Castaway Lou', skin: 'character-male-c', region: 'isle', at: [2, -3], behavior: 'sit', pitch: 1.0,
    hi: 'A visitor?!',
    lines: [
      'You made it! Nobody makes it! Want a coconut? I don\'t have any. I just like asking.',
      'There\'s a treasure chest on this island. I never opened it. Felt rude.',
      'Honestly I could leave whenever. I just really like it here.',
    ],
  },
];

// Which critters live where: [type, count, wanderRadius]
export const CRITTERS = {
  village: [['dog', 2], ['cat', 2], ['chick', 2]],
  meadow: [['bunny', 4], ['bee', 4], ['deer', 1], ['caterpillar', 1]],
  farm: [['cow', 3], ['pig', 3], ['chick', 4], ['hog', 1]],
  forest: [['deer', 3], ['fox', 2], ['bunny', 2], ['koala', 1]],
  lake: [['beaver', 2], ['dog', 1]],
  grove: [['caterpillar', 3], ['bunny', 1]],
  mountain: [['panda', 2], ['monkey', 2]],
  harbor: [['crab', 3], ['cat', 1], ['parrot', 1]],
  lighthouse: [['crab', 2]],
  desert: [['lion', 2], ['giraffe', 2], ['elephant', 2], ['tiger', 1]],
  oasis: [['monkey', 2], ['parrot', 2]],
  frost: [['penguin', 6], ['polar', 2]],
  crater: [['fox', 1], ['koala', 1]],
  ruins: [['fox', 1], ['panda', 1], ['deer', 1]],
  isle: [['crab', 3], ['parrot', 2]],
};

export const CRITTER_NAMES = {
  beaver: 'Beaver', bee: 'Bee', bunny: 'Bunny', cat: 'Cat', caterpillar: 'Caterpillar', chick: 'Chick', cow: 'Cow',
  crab: 'Crab', deer: 'Deer', dog: 'Dog', elephant: 'Elephant', fish: 'Fish', fox: 'Fox', giraffe: 'Giraffe', hog: 'Hog',
  koala: 'Koala', lion: 'Lion', monkey: 'Monkey', panda: 'Panda', parrot: 'Parrot', penguin: 'Penguin', pig: 'Pig',
  polar: 'Polar Bear', tiger: 'Tiger',
};
