// Which real Minecraft texture files the game uses. Shared by the browser (icons.js) and `npm run textures` (scripts/get-textures.mjs).
import { I, TOOL_KINDS } from './items.js';
import { ARMOR_TYPES } from './items.js';

export const GRASS = [145, 189, 89], FOLIAGE = [119, 171, 47], WATER_TINT = [63, 118, 228]; // plains biome colours the real game multiplies onto its grey textures
export const BLOCK_TILES = { // atlas tile -> [texture file, tint]
  0: ['grass_block_top', GRASS], 2: ['dirt'], 3: ['stone'], 4: ['sand'], 6: ['oak_log'], 7: ['oak_log_top'], 9: ['snow'], 10: ['oak_planks'], 11: ['glass'],
  12: ['bricks'], 13: ['bedrock'], 14: ['coal_ore'], 15: ['iron_ore'], 16: ['gold_ore'], 17: ['cobblestone'], 18: ['gravel'], 19: ['diamond_ore'],
  20: ['crafting_table_top'], 21: ['crafting_table_side'], 22: ['furnace_top'], 23: ['furnace_front'], 26: ['white_wool'], 27: ['torch'], 32: ['obsidian'], 33: ['lava_still'],
  34: ['cactus_side'], 35: ['cactus_top'], 36: ['cactus_bottom'], 37: ['dead_bush', [255, 255, 255]], 38: ['spruce_log'], 39: ['spruce_log_top'], 41: ['snow', [208, 226, 246]],
  48: ['birch_log'], 49: ['birch_log_top'], 51: ['birch_planks'], 52: ['spruce_planks'], 53: ['grass', GRASS], 54: ['tall_grass_top', GRASS], // generation 7 (the green and indigo flowers, wool and beds are made from these in icons.js)
  55: ['poppy', [255, 255, 255]], 56: ['orange_tulip', [255, 255, 255]], 57: ['dandelion', [255, 255, 255]], 59: ['blue_orchid', [255, 255, 255]], 61: ['allium', [255, 255, 255]], // (packed snow is the snow texture with a cool blue tint)
};
export const BLOCK_FILES = [...new Set([...Object.values(BLOCK_TILES).map((v) => v[0]), 'grass_block_side', 'grass_block_side_overlay', 'oak_leaves', 'spruce_leaves', 'birch_leaves', 'water_still', 'water_flow', 'red_wool', ...Array.from({ length: 10 }, (_, i) => `destroy_stage_${i}`)])];
export const ITEM_FILE = {
  [I.STICK]: 'stick', [I.COAL]: 'coal', [I.IRON_INGOT]: 'iron_ingot', [I.GOLD_INGOT]: 'gold_ingot', [I.DIAMOND]: 'diamond', [I.FLINT]: 'flint', [I.APPLE]: 'apple',
  [I.ROTTEN]: 'rotten_flesh', [I.BONE]: 'bone', [I.STRING]: 'string', [I.ARROW]: 'arrow', [I.FEATHER]: 'feather', [I.LEATHER]: 'leather', [I.GUNPOWDER]: 'gunpowder',
  [I.SLIME]: 'slime_ball', [I.RAW_PORK]: 'porkchop', [I.COOKED_PORK]: 'cooked_porkchop', [I.RAW_BEEF]: 'beef', [I.STEAK]: 'cooked_beef', [I.RAW_CHICKEN]: 'chicken',
  [I.COOKED_CHICKEN]: 'cooked_chicken', [I.RAW_MUTTON]: 'mutton', [I.COOKED_MUTTON]: 'cooked_mutton', [I.RAW_RABBIT]: 'rabbit', [I.COOKED_RABBIT]: 'cooked_rabbit',
  [I.TROPICAL_FISH]: 'tropical_fish', [I.SEAWEED]: 'kelp', 340: 'oak_boat', 341: 'spruce_boat', 342: 'birch_boat',
  [I.BOW]: 'bow', [I.BUCKET]: 'bucket', [I.WATER_BUCKET]: 'water_bucket', [I.RAW_SALMON]: 'salmon', [I.COOKED_SALMON]: 'cooked_salmon', [I.BED]: 'red_bed',
};
Object.assign(ITEM_FILE, { 410: 'wheat_seeds', 411: 'wheat', 412: 'bread', 413: 'golden_apple', 414: 'fishing_rod' });
['wooden', 'stone', 'iron', 'golden', 'diamond'].forEach((m, mi) => { ITEM_FILE[400 + mi] = `${m}_hoe`; });
TOOL_KINDS.forEach((k, ki) => ['wooden', 'stone', 'iron', 'golden', 'diamond'].forEach((m, mi) => { ITEM_FILE[290 + ki * 5 + mi] = `${m}_${k}`; }));
ARMOR_TYPES.forEach((_, ti) => ['leather', 'iron', 'golden', 'diamond'].forEach((m, mi) => { ITEM_FILE[310 + ti * 4 + mi] = `${m}_${['helmet', 'chestplate', 'leggings', 'boots'][ti]}`; }));
export const ENV_FILES = [['sun', ['environment/sun', 'environment/celestial/sun']], ['moon', ['environment/moon_phases', 'environment/celestial/moon/full_moon', 'environment/celestial/moon_phases']]];
// Other pictures taken from the same texture folder (paths below textures/). The chest is a 3D model in the real game, so its faces are cut out of the model's skin.
export const GUI_FILES = ['gui/icons']; // health, hunger, armor and air sprites
export const ENTITY_FILES = [['chest', 'entity/chest/normal']];
// The textures this game is drawn with are the ones from before the 1.14 texture overhaul, i.e. Minecraft 1.13.2 and older.
export const TEXTURE_VERSION = '1.13.2';
