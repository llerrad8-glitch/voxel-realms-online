// Creature stats shared by the server (behaviour) and the browser (names, hitboxes).
import { I, toolId } from './items.js';
import { B } from './world.js';

export const MOB_TYPES = ['pig', 'cow', 'sheep', 'chicken', 'rabbit', 'wolf', 'zombie', 'skeleton', 'spider', 'boomer', 'slime', 'salmon', 'tropical', 'duck', 'seagle', 'pirate'];
// kind: passive | neutral (fights back) | hostile. drops: [item, min, max, chance = 1]
export const MOBS = {
  pig: { name: 'Pig', hp: 10, w: 0.9, h: 0.9, speed: 1.6, kind: 'passive', drops: [[I.RAW_PORK, 1, 3]] },
  cow: { name: 'Cow', hp: 10, w: 0.9, h: 1.4, speed: 1.4, kind: 'passive', drops: [[I.RAW_BEEF, 1, 3], [I.LEATHER, 0, 2]] },
  sheep: { name: 'Sheep', hp: 8, w: 0.9, h: 1.3, speed: 1.5, kind: 'passive', drops: [[B.WOOL, 1, 1], [I.RAW_MUTTON, 1, 2]] },
  chicken: { name: 'Chicken', hp: 4, w: 0.4, h: 0.7, speed: 1.3, kind: 'passive', drops: [[I.RAW_CHICKEN, 1, 1], [I.FEATHER, 0, 2]] },
  rabbit: { name: 'Rabbit', hp: 3, w: 0.4, h: 0.5, speed: 2.4, kind: 'passive', hop: true, drops: [[I.RAW_RABBIT, 0, 1]] },
  wolf: { name: 'Wolf', hp: 8, w: 0.6, h: 0.85, speed: 3.4, kind: 'neutral', dmg: 3, drops: [] },
  zombie: { name: 'Zombie', hp: 20, w: 0.6, h: 1.95, speed: 2.5, kind: 'hostile', dmg: 3, sight: 22, burns: true, drops: [[I.ROTTEN, 0, 2], [I.IRON_INGOT, 1, 1, 0.03]] },
  skeleton: { name: 'Skeleton', hp: 20, w: 0.6, h: 1.95, speed: 2.3, kind: 'hostile', dmg: 3, sight: 18, burns: true, ranged: true, drops: [[I.BONE, 0, 2], [I.ARROW, 0, 2]] },
  spider: { name: 'Spider', hp: 16, w: 1.4, h: 0.9, speed: 3.6, kind: 'hostile', dmg: 2, sight: 18, drops: [[I.STRING, 0, 2]] },
  boomer: { name: 'Boomer', hp: 20, w: 0.6, h: 1.7, speed: 2.4, kind: 'hostile', sight: 18, drops: [[I.GUNPOWDER, 0, 2]] },
  salmon: { name: 'Salmon', hp: 3, w: 0.7, h: 0.4, speed: 2.2, kind: 'passive', swim: true, drops: [[I.RAW_SALMON, 1, 1], [I.BONE, 0, 1, 0.05]] },
  tropical: { name: 'Tropical Fish', hp: 3, w: 0.5, h: 0.4, speed: 2.0, kind: 'passive', swim: true, drops: [[I.TROPICAL_FISH, 1, 1]] }, // its size slot says which of the colour patterns it has (1 to 12)
  // Generation 12: birds. 'fly' birds are simulated in the air by the server (see thinkBird in server/ents.js).
  duck: { name: 'Duck', hp: 4, w: 0.5, h: 0.55, speed: 1.1, kind: 'passive', fly: true, drops: [[I.RAW_DUCK, 1, 2], [I.FEATHER, 0, 2]] },
  pirate: { name: 'Pirate', hp: 24, w: 0.6, h: 1.95, speed: 2.1, kind: 'hostile', dmg: 5, sight: 34, ship: true, drops: [[I.MUSKET_BALL, 0, 3], [I.GUNPOWDER, 0, 2], [I.IRON_INGOT, 0, 2, 0.5], [I.FLINTLOCK, 1, 1, 0.08], [toolId('sword', 2), 1, 1, 0.07]] }, // lives on a pirate ship; its look slot (aux) says what it carries: 0 an iron sword, 1 a flintlock pistol
  seagle: { name: 'Seagle', hp: 6, w: 0.7, h: 0.6, speed: 5, kind: 'passive', fly: true, drops: [[I.RAW_SEAGLE, 1, 1], [I.FEATHER, 1, 3]] },
  slime: { name: 'Slime', hp: 4, w: 0.55, h: 0.55, speed: 2.4, kind: 'hostile', dmg: 2, sight: 16, hop: true, drops: [] },
};
export const TROPICAL_LOOKS = 12;
export const mobDims = (type, size = 1) => (type === 'slime' ? { w: 0.55 * size, h: 0.55 * size } : { w: MOBS[type].w, h: MOBS[type].h });
