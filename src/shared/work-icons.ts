/** Official Palworld work-suitability UI icons (`game_data/icons/UI/T_icon_palwork_XX.png`). */
export const WORK_ICON_FILE: Record<string, string> = {
  Kindling: 'T_icon_palwork_00.png',
  Watering: 'T_icon_palwork_01.png',
  Planting: 'T_icon_palwork_02.png',
  Electricity: 'T_icon_palwork_03.png',
  Handiwork: 'T_icon_palwork_04.png',
  Gathering: 'T_icon_palwork_05.png',
  Lumbering: 'T_icon_palwork_06.png',
  Mining: 'T_icon_palwork_07.png',
  Medicine: 'T_icon_palwork_08.png',
  OilExtraction: 'T_icon_palwork_09.png',
  Cooling: 'T_icon_palwork_10.png',
  Transporting: 'T_icon_palwork_11.png',
  Farming: 'T_icon_palwork_12.png',
};

export function workIconStorageKey(version: string, file: string): string {
  return `icons/${version}/ui/${file}`;
}
