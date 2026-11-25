// Achievements. Every achievement has an id, a category, a name, a description and an icon (an item id). Its rule is one of:
//   have: [item ids]   obtain any one of these items (it only has to be in your inventory, armor, off hand or cursor once)
//   all: [item ids]    have all of these at once (a full armor set)
//   stat: [key, n]     a counter the server keeps reaches n (blocks mined, mobs killed, meters walked ...)
//   (nothing)          the server awards it by id when the thing happens (an event, a biome visited, a height reached)
import { B, BIOME_NAMES, LOG_IDS, PLANKS_IDS, isFlower, isLeaf, isSapling, isTorch, WHEAT0 } from './world.js';
import { I, ITEMS, toolId, armorId, hoeId, boatId, dyeId, bedItemId, MATS, ARMOR_MATS, ARMOR_TYPES } from './items.js';

export const CATS = ['Getting Started', 'Mining', 'Tools & Armor', 'Combat', 'Farming & Food', 'Nature', 'Exploration', 'Building', 'Survival'];
export const ACH = [];
const add = (id, cat, name, desc, ic, rule = {}) => { ACH.push({ id, cat, name, desc, ic, ...rule }); };
const have = (id, cat, name, desc, ic, ids) => add(id, cat, name, desc, ic, { have: ids || [ic] });
const stat = (id, cat, name, desc, ic, key, n) => add(id, cat, name, desc, ic, { stat: [key, n] });
const T = (n) => n.toLocaleString('en-US');
const ALL_LOGS = [...LOG_IDS, B.BANANA_LOG], BEDS = [0, 1, 2, 3, 4, 5, 6].map(bedItemId), FLOWERS = [];
for (let id = 100; id < 110; id++) if (isFlower(id) && ITEMS.has(id)) FLOWERS.push(id);

/* ---------- Getting Started ---------- */
const G = 'Getting Started';
add('join', G, 'Welcome!', 'Join a world.', B.GRASS);
have('log', G, 'Timber!', 'Get a log from a tree.', B.LOG, ALL_LOGS);
have('planks', G, 'Plank Planner', 'Craft some planks.', B.PLANKS, PLANKS_IDS);
have('stick', G, 'Sticks and Stones', 'Craft some sticks.', I.STICK);
have('table', G, 'Crafting Time', 'Make a crafting table.', B.TABLE);
have('wood_pick', G, 'Time to Mine!', 'Make a wooden pickaxe.', toolId('pickaxe', 0));
have('furnace', G, 'Hot Stuff', 'Make a furnace.', B.FURNACE);
have('torch', G, 'Let There Be Light', 'Make a torch.', B.TORCH);
have('chest', G, 'Storage Solution', 'Make a chest.', B.CHEST);
have('bed', G, 'Sweet Dreams', 'Make a bed.', I.BED, BEDS);
have('door', G, 'Knock Knock', 'Make a door.', I.DOOR);
have('bucket', G, 'Bucket List', 'Make a bucket.', I.BUCKET);
have('water_bucket', G, 'Fill It Up', 'Fill a bucket with water.', I.WATER_BUCKET);
have('lava_bucket', G, 'Hot Hot Hot', 'Fill a bucket with lava.', I.LAVA_BUCKET);
have('glass', G, 'Clear View', 'Get a block of glass.', B.GLASS);
have('wool', G, 'Fluffy', 'Get some wool.', B.WOOL);
add('open_table', G, 'Workbench', 'Use a crafting table.', B.TABLE);
add('open_chest', G, 'Peek Inside', 'Open a chest.', B.CHEST);
add('open_furnace', G, 'Fire It Up', 'Open a furnace.', B.FURNACE);
stat('craft1', G, 'Hands On', 'Craft your first item.', B.TABLE, 'crafted', 1);
stat('craft50', G, 'Craftsman', 'Craft 50 items.', B.TABLE, 'crafted', 50);
stat('craft500', G, 'Master Crafter', 'Craft 500 items.', B.TABLE, 'crafted', 500);
stat('craft3000', G, 'Factory Line', 'Craft 3,000 items.', B.TABLE, 'crafted', 3000);
stat('smelt1', G, 'Into the Fire', 'Take your first item out of a furnace.', B.FURNACE, 'smelted', 1);
stat('smelt100', G, 'Smelter', 'Take 100 items out of a furnace.', B.FURNACE, 'smelted', 100);
stat('smelt1000', G, 'Foundry', 'Take 1,000 items out of a furnace.', B.FURNACE, 'smelted', 1000);

/* ---------- Mining ---------- */
const M = 'Mining';
for (const [n, nm] of [[1, 'First Block'], [100, 'Block Breaker'], [1000, 'Digger'], [5000, 'Earth Mover'], [20000, 'Terraformer'], [100000, 'Mountain Remover']]) stat(`brk${n}`, M, nm, `Break ${T(n)} block${n > 1 ? 's' : ''}.`, toolId('pickaxe', n >= 5000 ? 4 : n >= 1000 ? 2 : 0), 'brk', n);
stat('dirt100', M, 'Dirt Digger', 'Dig up 100 dirt or grass blocks.', B.DIRT, 'brk:dirt', 100);
stat('dirt1000', M, 'Landscaper', 'Dig up 1,000 dirt or grass blocks.', B.DIRT, 'brk:dirt', 1000);
stat('stone50', M, 'Stone Age', 'Mine 50 stone.', B.COBBLE, 'brk:stone', 50);
stat('stone500', M, 'Quarryman', 'Mine 500 stone.', B.STONE, 'brk:stone', 500);
stat('stone5000', M, 'Hollow Mountain', 'Mine 5,000 stone.', B.STONE, 'brk:stone', 5000);
stat('sand50', M, 'Sandy Hands', 'Dig up 50 sand.', B.SAND, 'brk:sand', 50);
stat('gravel30', M, 'Gravel Grinder', 'Dig up 30 gravel.', B.GRAVEL, 'brk:gravel', 30);
stat('sandstone20', M, 'Desert Mason', 'Mine 20 sandstone.', B.SANDSTONE, 'brk:sandstone', 20);
stat('deep50', M, 'Deep Digger', 'Mine 50 deepslate.', B.DEEPSLATE, 'brk:deepslate', 50);
stat('deep500', M, 'Into the Deep', 'Mine 500 deepslate.', B.DEEPSLATE, 'brk:deepslate', 500);
have('coal', M, 'Coal Collector', 'Get some coal.', I.COAL);
stat('coalore25', M, 'Coal Miner', 'Mine 25 coal ore.', B.COAL, 'brk:coal', 25);
stat('coalore200', M, 'Black Lung', 'Mine 200 coal ore.', B.COAL, 'brk:coal', 200);
have('iron', M, 'Isn\'t It Iron-ic', 'Smelt an iron ingot.', I.IRON_INGOT);
stat('ironore25', M, 'Iron Miner', 'Mine 25 iron ore.', B.IRON, 'brk:iron', 25);
stat('ironore200', M, 'Iron Baron', 'Mine 200 iron ore.', B.IRON, 'brk:iron', 200);
have('gold', M, 'Golden Boy', 'Smelt a gold ingot.', I.GOLD_INGOT);
stat('goldore10', M, 'Gold Digger', 'Mine 10 gold ore.', B.GOLD, 'brk:gold', 10);
stat('goldore100', M, 'Gold Rush', 'Mine 100 gold ore.', B.GOLD, 'brk:gold', 100);
have('diamond', M, 'Diamonds!', 'Find a diamond.', I.DIAMOND);
stat('diaore5', M, 'Diamond Hunter', 'Mine 5 diamond ore.', B.DIAMOND, 'brk:diamond', 5);
stat('diaore50', M, 'Diamond Tycoon', 'Mine 50 diamond ore.', B.DIAMOND, 'brk:diamond', 50);
stat('ore100', M, 'Prospector', 'Mine 100 ores of any kind.', B.IRON, 'brk:ore', 100);
stat('ore1000', M, 'Ore Baron', 'Mine 1,000 ores of any kind.', B.GOLD, 'brk:ore', 1000);
stat('obsidian1', M, 'Ice Bucket Challenge', 'Mine a block of obsidian.', B.OBSIDIAN, 'brk:obsidian', 1);
stat('obsidian10', M, 'Hard as Obsidian', 'Mine 10 blocks of obsidian.', B.OBSIDIAN, 'brk:obsidian', 10);
add('deep', M, 'Into the Depths', 'Go down below layer 25.', B.DEEPSLATE);
add('bottom', M, 'Rock Bottom', 'Reach the very bottom of the world.', B.DEEPSLATE);
add('scoop_lava', M, 'Lava Scooper', 'Pick up a lava source with a bucket.', I.LAVA_BUCKET);
add('pour_lava', M, 'Lava Lamp', 'Pour lava out of a bucket.', I.LAVA_BUCKET);
add('flint', M, 'Spark', 'Find some flint.', I.FLINT);
have('flint_', M, 'Spark Plug', 'Get some flint.', I.FLINT);
ACH.pop(); ACH.pop(); add('flint', M, 'Spark Plug', 'Find some flint in the gravel.', I.FLINT, { have: [I.FLINT] });

/* ---------- Tools & Armor ---------- */
const TA = 'Tools & Armor';
const matName = (m) => MATS[m].name, KINDS = ['pickaxe', 'axe', 'shovel', 'sword'];
for (let m = 0; m < 5; m++) for (const k of KINDS) { if (m === 0 && k === 'pickaxe') continue; have(`${k}${m}`, TA, `${matName(m)} ${k[0].toUpperCase() + k.slice(1)}`, `Craft a ${matName(m).toLowerCase()} ${k}.`, toolId(k, m)); }
for (let m = 0; m < 5; m++) have(`hoe${m}`, TA, `${matName(m)} Hoe`, `Craft a ${matName(m).toLowerCase()} hoe.`, hoeId(m));
const ART = ['a', 'a', '', ''];
for (let m = 0; m < 4; m++) for (let t = 0; t < 4; t++) have(`arm${m}${t}`, TA, `${ARMOR_MATS[m].name} ${ARMOR_TYPES[t]}`, `Craft ${ART[t] ? ART[t] + ' ' : ''}${ARMOR_MATS[m].name.toLowerCase()} ${ARMOR_TYPES[t].toLowerCase()}.`, armorId(t, m));
for (let m = 0; m < 4; m++) add(`set${m}`, TA, `${['Leather Lord', 'Iron Man', 'Gold Digger Deluxe', 'Diamond Knight'][m]}`, `Own a full set of ${ARMOR_MATS[m].name.toLowerCase()} armor.`, armorId(1, m), { all: [0, 1, 2, 3].map((t) => armorId(t, m)) });
have('shield', TA, 'Defender', 'Make a shield.', I.SHIELD);
have('bow', TA, 'Archer', 'Make a bow.', I.BOW);
have('arrow', TA, 'Quiver', 'Make some arrows.', I.ARROW);
have('rod', TA, 'Rod and Reel', 'Make a fishing rod.', I.FISHING_ROD);
have('musket', TA, 'Powder and Shot', 'Make a musket.', I.MUSKET);
have('musket_ball', TA, 'Lead Ball', 'Make a musket ball.', I.MUSKET_BALL);
have('flintlock', TA, 'Pocket Pistol', 'Make a flintlock pistol.', I.FLINTLOCK);
have('shotgun', TA, 'Boom Stick', 'Make a shotgun.', I.SHOTGUN);
have('shotgun_shell', TA, 'Loaded Question', 'Make a shotgun shell.', I.SHOTGUN_SHELL);
have('paper', TA, 'Blank Page', 'Make some paper.', I.PAPER);
have('iron_block', TA, 'Heavy Metal', 'Make a block of iron.', B.IRON_BLOCK);
have('gold_block', TA, 'Gold Standard', 'Make a block of gold.', B.GOLD_BLOCK);
have('diamond_block', TA, 'Diamond Hoard', 'Make a block of diamond.', B.DIAMOND_BLOCK);
have('coal_block', TA, 'Mountain of Coal', 'Make a block of coal.', B.COAL_BLOCK);
have('gunpowder', TA, 'Big Bada Boom', 'Get some gunpowder.', I.GUNPOWDER);
have('leather', TA, 'Cowhide', 'Get some leather.', I.LEATHER);
have('dye', TA, 'Colourful', 'Get a dye.', dyeId(0), [0, 1, 2, 3, 4, 5, 6].map(dyeId));

/* ---------- Combat ---------- */
const C = 'Combat';
const MOBN = { pig: ['Piggy Bank', 'Kill a pig.', I.RAW_PORK], cow: ['Cow Tipper', 'Kill a cow.', I.RAW_BEEF], sheep: ['Counting Sheep', 'Kill a sheep.', I.RAW_MUTTON], chicken: ['Fowl Play', 'Kill a chicken.', I.RAW_CHICKEN], rabbit: ['Rabbit Season', 'Catch a rabbit.', I.RAW_RABBIT], wolf: ['Who\'s Afraid of the Big Bad Wolf', 'Kill a wolf.', I.BONE], zombie: ['Monster Hunter', 'Kill a zombie.', I.ROTTEN], skeleton: ['Bone Collector', 'Kill a skeleton.', I.BONE], spider: ['Arachnophobia', 'Kill a spider.', I.STRING], boomer: ['Bye Bye Boomer', 'Kill a boomer before it goes off.', I.GUNPOWDER], slime: ['Squish!', 'Kill a slime.', I.SLIME], salmon: ['Catch of the Day', 'Kill a salmon.', I.RAW_SALMON], tropical: ['Colourful Catch', 'Kill a tropical fish.', I.TROPICAL_FISH] };
Object.assign(MOBN, { duck: ['Duck Hunt', 'Kill a duck.', I.RAW_DUCK], seagle: ['Sea Eagle Down', 'Kill a seagle.', I.RAW_SEAGLE] });
for (const [t, [nm, d, ic]] of Object.entries(MOBN)) stat(`kill_${t}`, C, nm, d, ic, `kill:${t}`, 1);
for (const [n, nm] of [[1, 'First Blood'], [10, 'Warrior'], [50, 'Slayer'], [200, 'Champion'], [1000, 'Legend'], [5000, 'Exterminator']]) stat(`kills${n}`, C, nm, `Defeat ${T(n)} creature${n > 1 ? 's' : ''}.`, toolId('sword', n >= 200 ? 4 : n >= 50 ? 2 : 0), 'kills', n);
for (const [n, nm] of [[10, 'Monster Hunter Jr.'], [50, 'Night Watch'], [250, 'Monster Slayer'], [1000, 'Nightmare']]) stat(`hostile${n}`, C, nm, `Defeat ${T(n)} hostile monsters.`, I.ROTTEN, 'hostile', n);
for (const [n, nm] of [[10, 'Zombie Squasher'], [100, 'Zombie Apocalypse']]) stat(`zomb${n}`, C, nm, `Kill ${n} zombies.`, I.ROTTEN, 'kill:zombie', n);
for (const [n, nm] of [[10, 'Skeleton Crew'], [100, 'Boneyard']]) stat(`skel${n}`, C, nm, `Kill ${n} skeletons.`, I.BONE, 'kill:skeleton', n);
stat('spider25', C, 'Exterminator Spider', 'Kill 25 spiders.', I.STRING, 'kill:spider', 25);
stat('slime25', C, 'Slime Time', 'Kill 25 slimes.', I.SLIME, 'kill:slime', 25);
stat('boomer10', C, 'Defuser', 'Kill 10 boomers.', I.GUNPOWDER, 'kill:boomer', 10);
have('bone', C, 'Bone Meal', 'Get a bone.', I.BONE);
have('string', C, 'Web Weaver', 'Get some string.', I.STRING);
have('feather', C, 'Light as a Feather', 'Get a feather.', I.FEATHER);
have('slime', C, 'Slimy', 'Get a slimeball.', I.SLIME);
have('rotten', C, 'Smells Funny', 'Get some rotten flesh.', I.ROTTEN);
add('crit', C, 'Critical Hit', 'Land a critical hit while falling.', toolId('axe', 2));
add('shield_block', C, 'Not Today', 'Block an attack with your shield.', I.SHIELD);
add('tame_wolf', C, 'Best Friends Forever', 'Tame a wolf with a bone.', I.BONE);
stat('tame3', C, 'Pack Leader', 'Tame 3 wolves.', I.BONE, 'tamed', 3);
stat('arrow1', C, 'Sharpshooter', 'Shoot an arrow.', I.ARROW, 'arrows', 1);
stat('arrow100', C, 'Robin Hood', 'Shoot 100 arrows.', I.BOW, 'arrows', 100);
add('musket_fire', C, 'Fire!', 'Fire a musket.', I.MUSKET);
add('flintlock_fire', C, 'Quick Draw', 'Fire a flintlock pistol.', I.FLINTLOCK);
add('shotgun_fire', C, 'Scattershot', 'Fire a shotgun.', I.SHOTGUN);
add('hurt_cactus', C, 'Ouch! Prickly', 'Get pricked by a cactus.', B.CACTUS);
add('hurt_fall', C, 'Gravity Check', 'Take damage from a fall.', B.SAND);
add('hurt_lava', C, 'The Floor Is Lava', 'Get burned by lava.', I.LAVA_BUCKET);
add('hurt_drown', C, 'Deep Breaths', 'Start drowning.', I.WATER_BUCKET);
add('hurt_arrow', C, 'Pincushion', 'Get hit by an arrow.', I.ARROW);
add('hurt_boom', C, 'Sssss... Boom', 'Be caught in a boomer\'s blast.', I.GUNPOWDER);
add('hurt_suffocate', C, 'Stuck in a Wall', 'Suffocate inside blocks.', B.STONE);
add('close_call', C, 'Close Call', 'Survive with half a heart or less.', I.GOLDEN_APPLE);
stat('death1', C, 'You Died', 'Die for the first time.', I.ROTTEN, 'deaths', 1);
stat('death10', C, 'Try Again', 'Die 10 times.', I.ROTTEN, 'deaths', 10);
stat('death50', C, 'Stubborn', 'Die 50 times.', I.ROTTEN, 'deaths', 50);
stat('hurt100', C, 'Bruised', 'Take 100 hearts of damage in total.', I.APPLE, 'hurt', 200);

/* ---------- Farming & Food ---------- */
const F = 'Farming & Food';
have('hoe', F, 'Farmer\'s Life', 'Make a hoe.', hoeId(0), [0, 1, 2, 3, 4].map(hoeId));
add('till', F, 'Tilling the Soil', 'Turn grass or dirt into farmland with a hoe.', hoeId(1));
have('seeds', F, 'Seed Collector', 'Find some wheat seeds.', I.WHEAT_SEEDS);
add('sow', F, 'Sowing Seeds', 'Plant wheat seeds on farmland.', I.WHEAT_SEEDS);
have('wheat', F, 'Harvest Time', 'Harvest some wheat.', I.WHEAT);
have('bread', F, 'Bread Winner', 'Bake bread.', I.BREAD);
stat('wheat50', F, 'Wheat Farmer', 'Harvest 50 ripe wheat plants.', I.WHEAT, 'brk:wheat', 50);
stat('wheat500', F, 'Breadbasket', 'Harvest 500 ripe wheat plants.', I.BREAD, 'brk:wheat', 500);
const FOODS = [[I.APPLE, 'apple', 'An Apple a Day', 'Eat an apple.'], [I.COOKED_PORK, 'pork', 'Bacon!', 'Eat a cooked porkchop.'], [I.STEAK, 'steak', 'Steak Dinner', 'Eat a steak.'], [I.COOKED_CHICKEN, 'chicken', 'Chicken Dinner', 'Eat cooked chicken.'], [I.COOKED_MUTTON, 'mutton', 'Lamb Chops', 'Eat cooked mutton.'], [I.COOKED_RABBIT, 'rabbit', 'Rabbit Stew-ish', 'Eat cooked rabbit.'], [I.COOKED_SALMON, 'salmon', 'Fish Supper', 'Eat cooked salmon.'], [I.BREAD, 'bread', 'Daily Bread', 'Eat bread.'], [I.GOLDEN_APPLE, 'gapple', 'Golden Snack', 'Eat a golden apple.'], [I.ROTTEN, 'rotten', 'Desperate Times', 'Eat rotten flesh.'], [I.RAW_PORK, 'rawpork', 'Living Dangerously', 'Eat raw pork.'], [I.RAW_BEEF, 'rawbeef', 'Tartare', 'Eat raw beef.'], [I.RAW_CHICKEN, 'rawchicken', 'Salmonella Special', 'Eat raw chicken.'], [I.RAW_SALMON, 'rawsalmon', 'Sushi Chef', 'Eat raw salmon.'], [I.TROPICAL_FISH, 'tropical', 'Tropical Taste', 'Eat a tropical fish.'], [I.BLACKBERRY, 'blackberry', 'Blackberry Jam', 'Eat a blackberry.'], [I.STRAWBERRY, 'strawberry', 'Strawberry Fields', 'Eat a strawberry.'], [I.HUCKLEBERRY, 'huckleberry', 'Huckleberry Friend', 'Eat a huckleberry.'], [I.BANANA, 'banana', 'Going Bananas', 'Eat a banana.'], [I.COOKIE, 'cookie', 'Cookie Monster', 'Eat a cookie.'], [I.CHOCOLATE, 'chocolate', 'Sweet Tooth', 'Eat a bar of chocolate.']];
for (const [id, k, nm, d] of FOODS) stat(`eat_${k}`, F, nm, d, id, `eat:${id}`, 1);
for (const [n, nm] of [[10, 'Snacker'], [50, 'Hungry Hungry'], [250, 'Gourmet'], [1000, 'Bottomless Pit']]) stat(`eat${n}`, F, nm, `Eat ${T(n)} things.`, I.BREAD, 'eat', n);
for (const [id, k, nm, d] of [[I.COOKED_PORK, 'pork', 'Bacon Maker', 'Cook a porkchop.'], [I.STEAK, 'steak', 'Cooking With Fire', 'Cook a steak.'], [I.COOKED_CHICKEN, 'chicken', 'Roast Chicken', 'Cook some chicken.'], [I.COOKED_MUTTON, 'mutton', 'Roast Mutton', 'Cook some mutton.'], [I.COOKED_RABBIT, 'rabbit', 'Rabbit Roast', 'Cook some rabbit.'], [I.COOKED_SALMON, 'salmon', 'Smoked Salmon', 'Cook a salmon.']]) have(`cook_${k}`, F, nm, d, id);
have('golden_apple', F, 'Golden Delicious', 'Make a golden apple.', I.GOLDEN_APPLE);
have('apple', F, 'Orchard', 'Get an apple from a tree.', I.APPLE);
have('blackberry', F, 'Blackberry Picker', 'Find a blackberry.', I.BLACKBERRY);
have('strawberry', F, 'Strawberry Picker', 'Find a strawberry.', I.STRAWBERRY);
have('huckleberry', F, 'Huckleberry Picker', 'Find a huckleberry.', I.HUCKLEBERRY);
have('banana', F, 'Banana Hammock', 'Get a banana from a banana tree.', I.BANANA);
have('allberries', F, 'Berry Basket', '', I.BLACKBERRY);
ACH.pop(); add('allberries', F, 'Berry Basket', 'Have a blackberry, a strawberry and a huckleberry at once.', I.STRAWBERRY, { all: [I.BLACKBERRY, I.STRAWBERRY, I.HUCKLEBERRY] });
add('plant_berry', F, 'Berry Gardener', 'Plant a berry.', I.BLACKBERRY);
add('plant_banana', F, 'Banana Planter', 'Plant a banana to grow a banana tree.', I.BANANA);
add('harvest_berry', F, 'Fruit of Your Labour', 'Pick berries from a ripe bush.', I.STRAWBERRY);
stat('berries25', F, 'Berry Picker', 'Pick 25 berries from bushes.', I.BLACKBERRY, 'berries', 25);
stat('berries100', F, 'Berry Berry Good', 'Pick 100 berries from bushes.', I.HUCKLEBERRY, 'berries', 100);
have('sap', F, 'Sticky Situation', 'Get some pine sap from pine needles.', I.PINE_SAP);
have('sugar', F, 'Sweet Stuff', 'Make some sugar.', I.SUGAR);
have('cane', F, 'Sugar Rush', 'Get some sugar cane.', B.SUGAR_CANE);
have('cocoa', F, 'Cocoa Bean Counter', 'Pick cocoa beans from a jungle tree.', I.COCOA);
have('chocolate', F, 'Chocolatier', 'Make chocolate.', I.CHOCOLATE);
have('cookie', F, 'Cookie Time', 'Bake cookies.', I.COOKIE);
stat('cookie_pile', F, 'Cookie Jar', 'Craft 20 cookies in total.', I.COOKIE, 'craft:' + I.COOKIE, 20);
have('seaweed', F, 'Underwater Gardener', 'Get some seaweed.', I.SEAWEED);
have('rod2', F, 'Hook, Line and Sinker', 'Make a fishing rod.', I.FISHING_ROD);
ACH.pop();
stat('fish1', F, 'Gone Fishin\'', 'Catch a fish with a rod.', I.RAW_SALMON, 'fish', 1);
stat('fish10', F, 'Reel Deal', 'Catch 10 fish.', I.RAW_SALMON, 'fish', 10);
stat('fish50', F, 'Master Angler', 'Catch 50 fish.', I.FISHING_ROD, 'fish', 50);
stat('fish200', F, 'Fisherman\'s Friend', 'Catch 200 fish.', I.TROPICAL_FISH, 'fish', 200);
add('fish_tropical', F, 'Tropical Catch', 'Reel in a tropical fish.', I.TROPICAL_FISH);
add('fish_salmon', F, 'Salmon Run', 'Reel in a salmon.', I.RAW_SALMON);

/* ---------- Nature ---------- */
const N = 'Nature';
const SAPS = ['Oak', 'Spruce', 'Birch', 'Pine', 'Jungle', 'Banana'];
SAPS.forEach((nm, k) => have(`sapling${k}`, N, `${nm} Sapling`, `Get ${k === 0 ? 'an' : 'a'} ${nm.toLowerCase()} sapling from leaves${k === 5 ? ' (plant a banana)' : ''}.`.replace(' from leaves (plant a banana)', ' (by planting a banana)'), 186 + k));
stat('sapling_plant', N, 'Reforestation', 'Plant a sapling.', 186, 'place:sapling', 1);
stat('sapling_plant20', N, 'Tree Hugger', 'Plant 20 saplings.', 187, 'place:sapling', 20);
stat('log100', N, 'Lumberjack', 'Chop 100 logs.', B.LOG, 'brk:log', 100);
stat('log1000', N, 'Deforestation', 'Chop 1,000 logs.', toolId('axe', 4), 'brk:log', 1000);
stat('leaves200', N, 'Leaf Blower', 'Break 200 leaves.', B.LEAVES, 'brk:leaves', 200);
stat('snow20', N, 'Let It Snow', 'Dig up 20 snow blocks.', B.SNOW, 'brk:snow', 20);
stat('cactus1', N, 'Prickly Pear', 'Cut down a cactus.', B.CACTUS, 'brk:cactus', 1);
stat('cane50', N, 'Cane Cutter', 'Cut 50 sugar canes.', B.SUGAR_CANE, 'brk:cane', 50);
stat('cocoa20', N, 'Cocoa Farmer', 'Pick 20 cocoa pods.', I.COCOA, 'brk:cocoa', 20);
have('flower', N, 'Flower Power', 'Pick a flower.', FLOWERS[0] || B.GRASS, FLOWERS);
have('cactus', N, 'Desert Souvenir', 'Get a cactus.', B.CACTUS);
have('pine_log', N, 'Pining for Wood', 'Get a pine log.', B.PINE_LOG);
have('jungle_log', N, 'Jungle Wood', 'Get a jungle log.', B.JUNGLE_LOG);
have('banana_log', N, 'Banana Wood', 'Get a banana log.', B.BANANA_LOG);
have('spruce_log', N, 'Spruce Up', 'Get a spruce log.', B.SPRUCE_LOG);
have('birch_log', N, 'Birch Please', 'Get a birch log.', B.BIRCH_LOG);
have('all_logs', N, 'Arborist', 'Have all six kinds of log at once.', B.LOG);
ACH.pop(); add('all_logs', N, 'Arborist', 'Have every kind of log at once.', B.JUNGLE_LOG, { all: ALL_LOGS });
have('obsidian', N, 'Obsidian Obtained', 'Get a block of obsidian.', B.OBSIDIAN);
have('snowblock', N, 'Cold Hands', 'Get some snow.', B.SNOW);

/* ---------- Exploration ---------- */
const E = 'Exploration';
const BIO_IC = [B.GRASS, B.SAND, B.SPRUCE_LOG, B.SNOW, B.DIRT, B.PINE_LOG, B.JUNGLE_LOG], BIO_NAME = ['Into the Woods', 'Sand in Your Shoes', 'Winter Is Coming', 'Frozen Wastes', 'Wide Open Plains', 'Smell of Pine', 'Welcome to the Jungle'];
BIOME_NAMES.forEach((nm, b) => add(`biome${b}`, E, BIO_NAME[b], `Visit the ${nm} biome.`, BIO_IC[b]));
add('all_biomes', E, 'Adventuring Time', 'Visit every biome.', I.GOLDEN_APPLE);
for (const [n, nm] of [[100, 'A Short Stroll'], [1000, 'On Foot'], [5000, 'Wanderer'], [20000, 'Trailblazer'], [100000, 'Marathon Runner'], [500000, 'Around the World']]) stat(`walk${n}`, E, nm, `Walk ${T(n)} blocks.`, armorId(3, n >= 20000 ? 3 : 1), 'walk', n);
for (const [n, nm] of [[100, 'Doggy Paddle'], [1000, 'Swimmer'], [10000, 'Aquaman']]) stat(`swim${n}`, E, nm, `Swim ${T(n)} blocks.`, I.WATER_BUCKET, 'swim', n);
for (const [n, nm] of [[100, 'Row, Row, Row'], [1000, 'Captain'], [10000, 'Admiral']]) stat(`boatm${n}`, E, nm, `Travel ${T(n)} blocks in a boat.`, boatId(0), 'boatm', n);
for (const [n, nm] of [[10, 'Just Started'], [60, 'Settled In'], [180, 'Regular'], [600, 'Dedicated'], [3000, 'No Life']]) stat(`mins${n}`, E, nm, `Play for ${n >= 60 ? n / 60 + (n === 60 ? ' hour' : ' hours') : n + ' minutes'}.`, I.BED, 'mins', n);
add('high', E, 'Top of the World', 'Climb above layer 150.', B.SNOW);
add('sky', E, 'Cloud Walker', 'Climb above layer 190.', B.SNOW);
add('far1000', E, 'Far From Home', 'Be 1,000 blocks from where you started.', I.FISHING_ROD);
add('far5000', E, 'Explorer', 'Be 5,000 blocks from where you started.', I.GOLDEN_APPLE);
add('far20000', E, 'Edge of the Map', 'Be 20,000 blocks from where you started.', I.DIAMOND);
for (let k = 0; k < 6; k++) add(`boat_k${k}`, E, `${SAPS[k]} Sailor`, `Sit in ${k === 0 ? 'an' : 'a'} ${SAPS[k].toLowerCase()} boat.`, boatId(k));
add('boat_place', E, 'All Aboard', 'Put a boat on the water.', boatId(0));
add('boat_ride', E, 'Ahoy!', 'Climb into a boat.', boatId(2));
add('banana_boat', E, 'Peel Out', 'Sail a banana boat.', boatId(5));
stat('slept1', E, 'Good Night', 'Sleep through a night.', I.BED, 'slept', 1);
stat('slept10', E, 'Well Rested', 'Sleep through 10 nights.', I.BED, 'slept', 10);
stat('slept50', E, 'Sleeping Beauty', 'Sleep through 50 nights.', I.BED, 'slept', 50);

/* ---------- Building ---------- */
const BU = 'Building';
for (const [n, nm] of [[1, 'Foundation'], [100, 'Builder'], [500, 'Architect'], [2000, 'Master Builder'], [10000, 'Cathedral Builder'], [50000, 'Pyramid Maker']]) stat(`place${n}`, BU, nm, `Place ${T(n)} block${n > 1 ? 's' : ''}.`, B.BRICKS, 'place', n);
for (const [n, nm] of [[10, 'Torch Bearer'], [50, 'Lighthouse'], [250, 'Never Dark']]) stat(`torch${n}`, BU, nm, `Place ${n} torches.`, B.TORCH, 'place:torch', n);
for (const [n, nm] of [[10, 'Glasshouse'], [100, 'Stained Glass Wall']]) stat(`glassp${n}`, BU, nm, `Place ${n} blocks of glass.`, B.GLASS, 'place:glass', n);
stat('bricks50', BU, 'Brick by Brick', 'Place 50 bricks.', B.BRICKS, 'place:bricks', 50);
stat('planks100', BU, 'Carpenter', 'Place 100 planks.', B.PLANKS, 'place:planks', 100);
stat('wool50', BU, 'Colour Wall', 'Place 50 blocks of wool.', B.WOOL, 'place:wool', 50);
stat('cobble200', BU, 'Fortress', 'Place 200 cobblestone.', B.COBBLE, 'place:cobble', 200);
stat('chest5', BU, 'Warehouse', 'Place 5 chests.', B.CHEST, 'place:chest', 5);
stat('furnace5', BU, 'Smeltery', 'Place 5 furnaces.', B.FURNACE, 'place:furnace', 5);
add('door_use', BU, 'Open Sesame', 'Open or close a door.', I.DOOR);
add('pour_water', BU, 'Water Feature', 'Pour water out of a bucket.', I.WATER_BUCKET);
add('scoop_water', BU, 'Drained', 'Pick up water with a bucket.', I.BUCKET);
have('chunk_saver', BU, 'Landowner', 'Get a Chunk Saver.', B.CHUNK_SAVER);

/* ---------- Survival ---------- */
const S = 'Survival';
add('starve', S, 'Running on Empty', 'Let your hunger bar run all the way down.', I.ROTTEN);
add('full_inv', S, 'Hoarder', 'Fill every slot of your inventory.', B.CHEST);
add('regen', S, 'Patched Up', 'Heal back to full health after being hurt.', I.GOLDEN_APPLE);
add('night', S, 'Survived the Night', 'See the sun come up after a night outside.', I.BED);
add('sleep_bed', S, 'Tuck In', 'Climb into a bed.', I.BED);
add('diamond_gear', S, 'Cover Me in Diamonds', 'Wear a piece of diamond armor.', armorId(0, 3));
add('iron_gear', S, 'Suit Up', 'Wear a piece of iron armor.', armorId(0, 1));
stat('regen_big', S, 'Tough Skin', 'Take 1,000 hearts of damage in total.', armorId(1, 1), 'hurt', 2000);
add('all_done', S, 'Completionist', 'Earn every other achievement.', I.DIAMOND);

/* ---------- helpers shared by the server and the screen ---------- */
export const BY_ID = new Map(ACH.map((a) => [a.id, a]));
// Blocks that count toward a "mined N of this" group.
export const breakGroups = (id) => {
  const g = [];
  if (ALL_LOGS.includes(id)) g.push('log');
  if (id === B.STONE || id === B.COBBLE) g.push('stone');
  if (id === B.DIRT || id === B.GRASS) g.push('dirt');
  if (id === B.SAND) g.push('sand'); if (id === B.GRAVEL) g.push('gravel'); if (id === B.SANDSTONE) g.push('sandstone'); if (id === B.DEEPSLATE) g.push('deepslate');
  if (id === B.COAL || id === B.DS_COAL) g.push('coal', 'ore'); if (id === B.IRON || id === B.DS_IRON) g.push('iron', 'ore');
  if (id === B.GOLD || id === B.DS_GOLD) g.push('gold', 'ore'); if (id === B.DIAMOND || id === B.DS_DIAMOND) g.push('diamond', 'ore');
  if (id === B.OBSIDIAN) g.push('obsidian'); if (id === B.SNOW || id === B.PACKED_SNOW) g.push('snow'); if (isLeaf(id)) g.push('leaves');
  if (id === B.CACTUS) g.push('cactus'); if (id === B.SUGAR_CANE) g.push('cane'); if (id === WHEAT0 + 7) g.push('wheat'); if (id >= 204 && id <= 207) g.push('cocoa');
  return g;
};
export const placeGroups = (id) => {
  const g = [];
  if (isTorch(id)) g.push('torch'); if (id === B.GLASS) g.push('glass'); if (id === B.BRICKS) g.push('bricks'); if (id === B.WOOL || (id >= 22 && id <= 28)) g.push('wool');
  if (id === B.CHEST) g.push('chest'); if (id === B.FURNACE) g.push('furnace'); if (id === B.COBBLE) g.push('cobble'); if (isSapling(id)) g.push('sapling'); if (PLANKS_IDS.includes(id)) g.push('planks');
  return g;
};
