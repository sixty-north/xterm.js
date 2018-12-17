/**
 * Copyright (c) 2017 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { ITerminal, IBuffer, CharData, IBufferLine, IHighlightManager, IWordPosition } from './Types';
import { XtermListener } from './common/Types';
import * as Browser from './core/Platform';
import { EventEmitter } from './common/EventEmitter';
import { HighlightModel } from './HighlightModel';
import { CHAR_DATA_WIDTH_INDEX, CHAR_DATA_CHAR_INDEX, CHAR_DATA_CODE_INDEX } from './Buffer';


/**
 * A string containing all characters that are considered word separated by the
 * double click to select work logic.
 */
const WORD_SEPARATORS = ' ()[]{}\'"';

const NON_BREAKING_SPACE_CHAR = String.fromCharCode(160);
const ALL_NON_BREAKING_SPACE_REGEX = new RegExp(NON_BREAKING_SPACE_CHAR, 'g');

/**
 * A selection mode, this drives how the selection behaves on mouse move.
 */
export const enum HighlightMode {
  NORMAL,
  WORD,
  LINE,
  COLUMN
}

/**
 * A class that manages the selection of the terminal. With help from
 * SelectionModel, SelectionManager handles with all logic associated with
 * dealing with the selection, including handling mouse interaction, wide
 * characters and fetching the actual text within the selection. Rendering is
 * not handled by the SelectionManager but a 'refresh' event is fired when the
 * selection is ready to be redrawn.
 */
export class HighlightManager extends EventEmitter implements IHighlightManager {
  protected _model: HighlightModel;

  /**
   * The current selection mode.
   */
  protected _activeHighlightMode: HighlightMode;

  /**
   * The animation frame ID used for refreshing the selection.
   */
  private _refreshAnimationFrame: number;

  /**
   * Whether selection is enabled.
   */
  // private _enabled = true;

  private _trimListener: XtermListener;


  constructor(
    private _terminal: ITerminal
  ) {
    super();
    this._initListeners();
    this.enable();

    this._model = new HighlightModel(_terminal);
    this._activeHighlightMode = HighlightMode.NORMAL;
  }

  public dispose(): void {
    super.dispose();
  }

  private get _buffer(): IBuffer {
    return this._terminal.buffers.active;
  }

  /**
   * Initializes listener variables.
   */
  private _initListeners(): void {
    this._trimListener = (amount: number) => this._onTrim(amount);

    this.initBuffersListeners();
  }

  public initBuffersListeners(): void {
    this._terminal.buffer.lines.on('trim', this._trimListener);
    this._terminal.buffers.on('activate', e => this._onBufferActivate(e));
  }

  /**
   * Disables the selection manager. This is useful for when terminal mouse
   * are enabled.
   */
  public disable(): void {
    this.clearHighlight();
    // this._enabled = false;
  }

  /**
   * Enable the selection manager.
   */
  public enable(): void {
    // this._enabled = true;
  }

  public get highlightStart(): [number, number] { return this._model.finalHighlightStart; }
  public get highlightEnd(): [number, number] { return this._model.finalHighlightEnd; }

  /**
   * Gets whether there is an active text selection.
   */
  public get hasHighlight(): boolean {
    const start = this._model.finalHighlightStart;
    const end = this._model.finalHighlightEnd;
    if (!start || !end) {
      return false;
    }
    return start[0] !== end[0] || start[1] !== end[1];
  }

  /**
   * Gets the text currently selected.
   */
  public get highlightText(): string {
    const start = this._model.finalHighlightStart;
    const end = this._model.finalHighlightEnd;
    if (!start || !end) {
      return '';
    }

    const result: string[] = [];

    if (this._activeHighlightMode === HighlightMode.COLUMN) {
      // Ignore zero width selections
      if (start[0] === end[0]) {
        return '';
      }

      for (let i = start[1]; i <= end[1]; i++) {
        const lineText = this._buffer.translateBufferLineToString(i, true, start[0], end[0]);
        result.push(lineText);
      }
    } else {
      // Get first row
      const startRowEndCol = start[1] === end[1] ? end[0] : null;
      result.push(this._buffer.translateBufferLineToString(start[1], true, start[0], startRowEndCol));

      // Get middle rows
      for (let i = start[1] + 1; i <= end[1] - 1; i++) {
        const bufferLine = this._buffer.lines.get(i);
        const lineText = this._buffer.translateBufferLineToString(i, true);
        if (bufferLine.isWrapped) {
          result[result.length - 1] += lineText;
        } else {
          result.push(lineText);
        }
      }

      // Get final row
      if (start[1] !== end[1]) {
        const bufferLine = this._buffer.lines.get(end[1]);
        const lineText = this._buffer.translateBufferLineToString(end[1], true, 0, end[0]);
        if (bufferLine.isWrapped) {
          result[result.length - 1] += lineText;
        } else {
          result.push(lineText);
        }
      }
    }

    // Format string by replacing non-breaking space chars with regular spaces
    // and joining the array into a multi-line string.
    const formattedResult = result.map(line => {
      return line.replace(ALL_NON_BREAKING_SPACE_REGEX, ' ');
    }).join(Browser.isMSWindows ? '\r\n' : '\n');

    return formattedResult;
  }

  /**
   * Clears the current terminal selection.
   */
  public clearHighlight(): void {
    this._model.clearHighlight();
    this.refresh();
  }

  /**
   * Queues a refresh, redrawing the selection on the next opportunity.
   * @param isNewHighlight Whether the selection should be registered as a new
   * selection on Linux.
   */
  public refresh(isNewHighlight?: boolean): void {
    // Queue the refresh for the renderer
    if (!this._refreshAnimationFrame) {
      this._refreshAnimationFrame = window.requestAnimationFrame(() => this._refresh());
    }

    // If the platform is Linux and the refresh call comes from a mouse event,
    // we need to update the selection for middle click to paste selection.
    if (Browser.isLinux && isNewHighlight) {
      const selectionText = this.highlightText;
      if (selectionText.length) {
        this.emit('newhighlight', this.highlightText);
      }
    }
  }

  /**
   * Fires the refresh event, causing consumers to pick it up and redraw the
   * highlight state.
   */
  private _refresh(): void {
    this._refreshAnimationFrame = null;
    this.emit('refresh', {
      start: this._model.finalHighlightStart,
      end: this._model.finalHighlightEnd,
      columnSelectMode: this._activeHighlightMode === HighlightMode.COLUMN
    });
  }

  // /**
  //  * Checks if the current click was inside the current selection
  //  * @param event The mouse event
  //  */
  // public isClickInSelection(event: MouseEvent): boolean {
  //   const coords = this._getMouseBufferCoords(event);
  //   const start = this._model.finalSelectionStart;
  //   const end = this._model.finalSelectionEnd;
  //
  //   if (!start || !end) {
  //     return false;
  //   }
  //
  //   return this._areCoordsInSelection(coords, start, end);
  // }

  protected _areCoordsInSelection(coords: [number, number], start: [number, number], end: [number, number]): boolean {
    return (coords[1] > start[1] && coords[1] < end[1]) ||
        (start[1] === end[1] && coords[1] === start[1] && coords[0] >= start[0] && coords[0] < end[0]) ||
        (start[1] < end[1] && coords[1] === end[1] && coords[0] < end[0]) ||
        (start[1] < end[1] && coords[1] === start[1] && coords[0] >= start[0]);
  }

  /**
   * Selects all text within the terminal.
   */
  public highlightAll(): void {
    this._model.isHighlightAllActive = true;
    this.refresh();
    this._terminal.emit('highlight');
  }

  public highlightLines(start: number, end: number): void {
    this._model.clearHighlight();
    start = Math.max(start, 0);
    end = Math.min(end, this._terminal.buffer.lines.length - 1);
    this._model.highlightStart = [0, start];
    this._model.highlightEnd = [this._terminal.cols, end];
    this.refresh();
    this._terminal.emit('highlight');
  }

  /**
   * Handle the buffer being trimmed, adjust the selection position.
   * @param amount The amount the buffer is being trimmed.
   */
  private _onTrim(amount: number): void {
    const needsRefresh = this._model.onTrim(amount);
    if (needsRefresh) {
      this.refresh();
    }
  }

  /**
   * Returns whether the selection manager should force selection, regardless of
   * whether the terminal is in mouse events mode.
   * @param event The mouse event.
   */
  public shouldForceSelection(event: MouseEvent): boolean {
    if (Browser.isMac) {
      return event.altKey && this._terminal.options.macOptionClickForcesSelection;
    }

    return event.shiftKey;
  }

  /**
   * Handles the mousedown event, setting up for a new highlight.
   * @param event The mousedown event.
   */
  public onMouseDown(event: MouseEvent): void {
    // Do nothing.
  }

  /**
   * Returns whether the selection manager should operate in column select mode
   * @param event the mouse or keyboard event
   */
  public shouldColumnSelect(event: KeyboardEvent | MouseEvent): boolean {
    return event.altKey && !(Browser.isMac && this._terminal.options.macOptionClickForcesSelection);
  }

  private _onBufferActivate(e: {activeBuffer: IBuffer, inactiveBuffer: IBuffer}): void {
    this.clearHighlight();
    // Only adjust the selection on trim, shiftElements is rarely used (only in
    // reverseIndex) and delete in a splice is only ever used when the same
    // number of elements was just added. Given this is could actually be
    // beneficial to leave the selection as is for these cases.
    e.inactiveBuffer.lines.off('trim', this._trimListener);
    e.activeBuffer.lines.on('trim', this._trimListener);
  }

  /**
   * Converts a viewport column to the character index on the buffer line, the
   * latter takes into account wide characters.
   * @param coords The coordinates to find the 2 index for.
   */
  private _convertViewportColToCharacterIndex(bufferLine: IBufferLine, coords: [number, number]): number {
    let charIndex = coords[0];
    for (let i = 0; coords[0] >= i; i++) {
      const char = bufferLine.get(i);
      if (char[CHAR_DATA_WIDTH_INDEX] === 0) {
        // Wide characters aren't included in the line string so decrement the
        // index so the index is back on the wide character.
        charIndex--;
      } else if (char[CHAR_DATA_CHAR_INDEX].length > 1 && coords[0] !== i) {
        // Emojis take up multiple characters, so adjust accordingly. For these
        // we don't want ot include the character at the column as we're
        // returning the start index in the string, not the end index.
        charIndex += char[CHAR_DATA_CHAR_INDEX].length - 1;
      }
    }
    return charIndex;
  }

  public setHighlight(col: number, row: number, length: number): void {
    this._model.clearHighlight();
    this._model.highlightStart = [col, row];
    this._model.highlightStartLength = length;
    this.refresh();
  }

  /**
   * Gets positional information for the word at the coordinated specified.
   * @param coords The coordinates to get the word at.
   */
  private _getWordAt(coords: [number, number], allowWhitespaceOnlyHighlight: boolean, followWrappedLinesAbove: boolean = true, followWrappedLinesBelow: boolean = true): IWordPosition {
    // Ensure coords are within viewport (eg. not within scroll bar)
    if (coords[0] >= this._terminal.cols) {
      return null;
    }

    const bufferLine = this._buffer.lines.get(coords[1]);
    if (!bufferLine) {
      return null;
    }

    const line = this._buffer.translateBufferLineToString(coords[1], false);

    // Get actual index, taking into consideration wide characters
    let startIndex = this._convertViewportColToCharacterIndex(bufferLine, coords);
    let endIndex = startIndex;

    // Record offset to be used later
    const charOffset = coords[0] - startIndex;
    let leftWideCharCount = 0;
    let rightWideCharCount = 0;
    let leftLongCharOffset = 0;
    let rightLongCharOffset = 0;

    if (line.charAt(startIndex) === ' ') {
      // Expand until non-whitespace is hit
      while (startIndex > 0 && line.charAt(startIndex - 1) === ' ') {
        startIndex--;
      }
      while (endIndex < line.length && line.charAt(endIndex + 1) === ' ') {
        endIndex++;
      }
    } else {
      // Expand until whitespace is hit. This algorithm works by scanning left
      // and right from the starting position, keeping both the index format
      // (line) and the column format (bufferLine) in sync. When a wide
      // character is hit, it is recorded and the column index is adjusted.
      let startCol = coords[0];
      let endCol = coords[0];

      // Consider the initial position, skip it and increment the wide char
      // variable
      if (bufferLine.get(startCol)[CHAR_DATA_WIDTH_INDEX] === 0) {
        leftWideCharCount++;
        startCol--;
      }
      if (bufferLine.get(endCol)[CHAR_DATA_WIDTH_INDEX] === 2) {
        rightWideCharCount++;
        endCol++;
      }

      // Adjust the end index for characters whose length are > 1 (emojis)
      if (bufferLine.get(endCol)[CHAR_DATA_CHAR_INDEX].length > 1) {
        rightLongCharOffset += bufferLine.get(endCol)[CHAR_DATA_CHAR_INDEX].length - 1;
        endIndex += bufferLine.get(endCol)[CHAR_DATA_CHAR_INDEX].length - 1;
      }

      // Expand the string in both directions until a space is hit
      while (startCol > 0 && startIndex > 0 && !this._isCharWordSeparator(bufferLine.get(startCol - 1))) {
        const char = bufferLine.get(startCol - 1);
        if (char[CHAR_DATA_WIDTH_INDEX] === 0) {
          // If the next character is a wide char, record it and skip the column
          leftWideCharCount++;
          startCol--;
        } else if (char[CHAR_DATA_CHAR_INDEX].length > 1) {
          // If the next character's string is longer than 1 char (eg. emoji),
          // adjust the index
          leftLongCharOffset += char[CHAR_DATA_CHAR_INDEX].length - 1;
          startIndex -= char[CHAR_DATA_CHAR_INDEX].length - 1;
        }
        startIndex--;
        startCol--;
      }
      while (endCol < bufferLine.length && endIndex + 1 < line.length && !this._isCharWordSeparator(bufferLine.get(endCol + 1))) {
        const char = bufferLine.get(endCol + 1);
        if (char[CHAR_DATA_WIDTH_INDEX] === 2) {
          // If the next character is a wide char, record it and skip the column
          rightWideCharCount++;
          endCol++;
        } else if (char[CHAR_DATA_CHAR_INDEX].length > 1) {
          // If the next character's string is longer than 1 char (eg. emoji),
          // adjust the index
          rightLongCharOffset += char[CHAR_DATA_CHAR_INDEX].length - 1;
          endIndex += char[CHAR_DATA_CHAR_INDEX].length - 1;
        }
        endIndex++;
        endCol++;
      }
    }

    // Incremenet the end index so it is at the start of the next character
    endIndex++;

    // Calculate the start _column_, converting the the string indexes back to
    // column coordinates.
    let start =
        startIndex // The index of the selection's start char in the line string
        + charOffset // The difference between the initial char's column and index
        - leftWideCharCount // The number of wide chars left of the initial char
        + leftLongCharOffset; // The number of additional chars left of the initial char added by columns with strings longer than 1 (emojis)

    // Calculate the length in _columns_, converting the the string indexes back
    // to column coordinates.
    let length = Math.min(this._terminal.cols, // Disallow lengths larger than the terminal cols
        endIndex // The index of the selection's end char in the line string
        - startIndex // The index of the selection's start char in the line string
        + leftWideCharCount // The number of wide chars left of the initial char
        + rightWideCharCount // The number of wide chars right of the initial char (inclusive)
        - leftLongCharOffset // The number of additional chars left of the initial char added by columns with strings longer than 1 (emojis)
        - rightLongCharOffset); // The number of additional chars right of the initial char (inclusive) added by columns with strings longer than 1 (emojis)

    if (!allowWhitespaceOnlyHighlight && line.slice(startIndex, endIndex).trim() === '') {
      return null;
    }

    // Recurse upwards if the line is wrapped and the word wraps to the above line
    if (followWrappedLinesAbove) {
      if (start === 0 && bufferLine.get(0)[CHAR_DATA_CODE_INDEX] !== 32 /*' '*/) {
        const previousBufferLine = this._buffer.lines.get(coords[1] - 1);
        if (previousBufferLine && bufferLine.isWrapped && previousBufferLine.get(this._terminal.cols - 1)[CHAR_DATA_CODE_INDEX] !== 32 /*' '*/) {
          const previousLineWordPosition = this._getWordAt([this._terminal.cols - 1, coords[1] - 1], false, true, false);
          if (previousLineWordPosition) {
            const offset = this._terminal.cols - previousLineWordPosition.start;
            start -= offset;
            length += offset;
          }
        }
      }
    }

    // Recurse downwards if the line is wrapped and the word wraps to the next line
    if (followWrappedLinesBelow) {
      if (start + length === this._terminal.cols && bufferLine.get(this._terminal.cols - 1)[CHAR_DATA_CODE_INDEX] !== 32 /*' '*/) {
        const nextBufferLine = this._buffer.lines.get(coords[1] + 1);
        if (nextBufferLine && nextBufferLine.isWrapped && nextBufferLine.get(0)[CHAR_DATA_CODE_INDEX] !== 32 /*' '*/) {
          const nextLineWordPosition = this._getWordAt([0, coords[1] + 1], false, false, true);
          if (nextLineWordPosition) {
            length += nextLineWordPosition.length;
          }
        }
      }
    }

    return { start, length };
  }

  /**
   * Selects the word at the coordinates specified.
   * @param coords The coordinates to get the word at.
   * @param allowWhitespaceOnlySelection If whitespace should be selected
   */
  protected _selectWordAt(coords: [number, number], allowWhitespaceOnlySelection: boolean): void {
    const wordPosition = this._getWordAt(coords, allowWhitespaceOnlySelection);
    if (wordPosition) {
      // Adjust negative start value
      while (wordPosition.start < 0) {
        wordPosition.start += this._terminal.cols;
        coords[1]--;
      }
      this._model.highlightStart = [wordPosition.start, coords[1]];
      this._model.highlightStartLength = wordPosition.length;
    }
  }

  /**
   * Gets whether the character is considered a word separator by the select
   * word logic.
   * @param char The character to check.
   */
  private _isCharWordSeparator(charData: CharData): boolean {
    // Zero width characters are never separators as they are always to the
    // right of wide characters
    if (charData[CHAR_DATA_WIDTH_INDEX] === 0) {
      return false;
    }
    return WORD_SEPARATORS.indexOf(charData[CHAR_DATA_CHAR_INDEX]) >= 0;
  }

  /**
   * Selects the line specified.
   * @param line The line index.
   */
  protected _selectLineAt(line: number): void {
    const wrappedRange = this._buffer.getWrappedRangeForLine(line);
    this._model.highlightStart = [0, wrappedRange.first];
    this._model.highlightEnd = [this._terminal.cols, wrappedRange.last];
    this._model.highlightStartLength = 0;
  }
}
