// Creature stats shared by the server (behaviour) and the browser (names, hitboxes).
import { I } from './items.js';
import { B } from './world.js';

export const MOB_TYPES = ['pig', 'cow', 'sheep', 'chicken', 'rabbit', 'wolf', 'zombie', 'skeleton', 'spider', 'boomer', 'slime'];
// kind: passive | neutral (fights back) | hostile. drops: [item, min, max, chance = 1]
export const MOBS = {
  pig: { name: 'Pig', hp: 10, w: 0.9, h: 0.9, speed: 1.6, kind: 'passive', drops: [[I.RAW_PORK, 1, 3]] },
  cow: { name: 'Cow', hp: 10, w: 0.9, h: 1.4, speed: 1.4, kind: 'passive', drops: [[I.RAW_BEEF, 1, 3], [I.LEATHER, 0, 2]] },
  sheep: { name: 'Sheep', hp: 8, w: 0.9, h: 1.3, speed: 1.5, kind: 'passive', drops: [[B.WOOL, 1, 1], [I.RAW_MUTTON, 1, 2]] },
  chicken: { name: 'Chicken', hp: 4, w: 0.4, h: 0.7, speed: 1.3, kind: 'passive', drops: [[I.RAW_CHICKEN, 1, 1], [I.FEATHER, 0, 2]] },
  rabbit: { name: 'Rabbit', hp: 3, w: 0.4, h: 0.5, speed: 2.4, kind: 'passive', hop: true, drops: [[I.RAW_RABBIT, 0, 1]] },
  wolf: { name: 'Wolf', hp: 8, w: 0.6, h: 0.85, speed: 3.4, kind: 'neutral', dmg: 3, drops: [] },
  zombie: { name: 'Zombie', hp: 20, w: 0.6, h: 1.95, speed: 2.5, kind: 'hostile', dmg: 3, sight: 22, burns: true, drops: [[I.ROTTEN, 0, 2], [I.IRON_INGOT, 1, 1, 0.03]] },
  skeleton: { name: 'Skeleton', hp: 20, w: 0.6, h: 1.95, speed: 2.3, kind: 'hostile', dmg: 3, sight: 24, burns: true, ranged: true, drops: [[I.BONE, 0, 2], [I.ARROW, 0, 2]] },
  spider: { name: 'Spider', hp: 16, w: 1.4, h: 0.9, speed: 3.6, kind: 'hostile', dmg: 2, sight: 18, drops: [[I.STRING, 0, 2]] },
  boomer: { name: 'Boomer', hp: 20, w: 0.6, h: 1.7, speed: 2.4, kind: 'hostile', sight: 18, drops: [[I.GUNPOWDER, 0, 2]] },
  slime: { name: 'Slime', hp: 4, w: 0.55, h: 0.55, speed: 2.4, kind: 'hostile', dmg: 2, sight: 16, hop: true, drops: [] },
};
export const mobDims = (type, size = 1) => (type === 'slime' ? { w: 0.55 * size, h: 0.55 * size } : { w: MOBS[type].w, h: MOBS[type].h });
