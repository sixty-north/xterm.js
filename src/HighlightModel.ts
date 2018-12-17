/**
 * Copyright (c) 2017 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { ITerminal } from './Types';


/**
 * Represents a highlighted region within the buffer. This model only cares about column
 * and row coordinates, not wide characters.
 */
export class HighlightModel {
  /**
   * Whether highlight all is currently active.
   */
  public isHighlightAllActive: boolean;

  /**
   * The [x, y] position the highlight starts at.
   */
  public highlightStart: [number, number];

  /**
   * The minimal length of the highlight from the start position. When double
   * clicking on a word, the word will be highlighted which makes the highlight
   * start at the start of the word and makes this variable the length.
   */
  public highlightStartLength: number;

  /**
   * The [x, y] position the highlight ends at.
   */
  public highlightEnd: [number, number];

  constructor(
    private _terminal: ITerminal
  ) {
    this.clearHighlight();
  }

  /**
   * Clears the current highlight.
   */
  public clearHighlight(): void {
    this.highlightStart = null;
    this.highlightEnd = null;
    this.isHighlightAllActive = false;
    this.highlightStartLength = 0;
  }

  /**
   * The final highlight start, taking into consideration highlight all.
   */
  public get finalHighlightStart(): [number, number] {
    if (this.isHighlightAllActive) {
      return [0, 0];
    }

    if (!this.highlightEnd || !this.highlightStart) {
      return this.highlightStart;
    }

    return this.areHighlightValuesReversed() ? this.highlightEnd : this.highlightStart;
  }

  /**
   * The final highlight end, taking into consideration highlight all.
   */
  public get finalHighlightEnd(): [number, number] {
    if (this.isHighlightAllActive) {
      return [this._terminal.cols, this._terminal.buffer.ybase + this._terminal.rows - 1];
    }

    if (!this.highlightStart) {
      return null;
    }

    // Use the highlight start + length if the end doesn't exist or they're reversed
    if (!this.highlightEnd || this.areHighlightValuesReversed()) {
      const startPlusLength = this.highlightStart[0] + this.highlightStartLength;
      if (startPlusLength > this._terminal.cols) {
        return [startPlusLength % this._terminal.cols, this.highlightStart[1] + Math.floor(startPlusLength / this._terminal.cols)];
      }
      return [startPlusLength, this.highlightStart[1]];
    }

    // Ensure the the word/line is highlighted after a double/triple click
    if (this.highlightStartLength) {
      // Highlight the larger of the two when start and end are on the same line
      if (this.highlightEnd[1] === this.highlightStart[1]) {
        return [Math.max(this.highlightStart[0] + this.highlightStartLength, this.highlightEnd[0]), this.highlightEnd[1]];
      }
    }
    return this.highlightEnd;
  }

  /**
   * Returns whether the highlight start and end are reversed.
   */
  public areHighlightValuesReversed(): boolean {
    const start = this.highlightStart;
    const end = this.highlightEnd;
    if (!start || !end) {
      return false;
    }
    return start[1] > end[1] || (start[1] === end[1] && start[0] > end[0]);
  }

  /**
   * Handle the buffer being trimmed, adjust the highlight position.
   * @param amount The amount the buffer is being trimmed.
   * @return Whether a refresh is necessary.
   */
  public onTrim(amount: number): boolean {
    // Adjust the highlight position based on the trimmed amount.
    if (this.highlightStart) {
      this.highlightStart[1] -= amount;
    }
    if (this.highlightEnd) {
      this.highlightEnd[1] -= amount;
    }

    // The highlight has moved off the buffer, clear it.
    if (this.highlightEnd && this.highlightEnd[1] < 0) {
      this.clearHighlight();
      return true;
    }

    // If the highlight start is trimmed, ensure the start column is 0.
    if (this.highlightStart && this.highlightStart[1] < 0) {
      this.highlightStart[1] = 0;
    }
    return false;
  }
}
