export interface ReplayUnitResponseDto {
  unit_state?: { CURRENT_PAGE_ID?: string };
  responses: { id: string; content: string }[];
  /** Stored answers from the selected subform already included in this player state. */
  subformResponseIds?: number[];
}
