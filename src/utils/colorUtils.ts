/**
 * Color utilities for the Agility extension.
 * Handles color emoji lookup, color pickers, and RGB distance calculations.
 */

import * as vscode from 'vscode';
import { colorPresets } from '../constants/colors';

/**
 * Parses a hex color string to RGB values.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace('#', '');
  return {
    r: parseInt(cleanHex.substring(0, 2), 16),
    g: parseInt(cleanHex.substring(2, 4), 16),
    b: parseInt(cleanHex.substring(4, 6), 16),
  };
}

/**
 * Calculates the Euclidean distance between two RGB colors.
 */
function colorDistance(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number }
): number {
  return Math.sqrt(
    Math.pow(c1.r - c2.r, 2) +
    Math.pow(c1.g - c2.g, 2) +
    Math.pow(c1.b - c2.b, 2)
  );
}

/**
 * Gets the closest emoji for a given hex color.
 * First checks for an exact match, then finds the nearest by RGB distance.
 */
export function getColorEmoji(hexColor: string): string {
  // Find exact match first
  const exactMatch = colorPresets.find(
    (p) => p.color.toLowerCase() === hexColor.toLowerCase()
  );
  if (exactMatch) {
    return exactMatch.emoji;
  }

  // Find closest color by RGB distance
  const targetRgb = hexToRgb(hexColor);
  let closestPreset = colorPresets[0];
  let minDistance = Infinity;

  for (const preset of colorPresets) {
    const presetRgb = hexToRgb(preset.color);
    const distance = colorDistance(targetRgb, presetRgb);

    if (distance < minDistance) {
      minDistance = distance;
      closestPreset = preset;
    }
  }

  return closestPreset.emoji;
}

/**
 * QuickPickItem extended with color properties.
 */
interface ColorPickerItem extends vscode.QuickPickItem {
  color?: string;
  isCustom?: boolean;
}

/**
 * Shows a color picker with preset colors and a custom color option.
 * @param statusName The name of the status being configured
 * @param currentColor The current hex color
 * @returns The selected hex color, or undefined if cancelled
 */
export async function showColorPicker(
  statusName: string,
  currentColor: string
): Promise<string | undefined> {
  const items: ColorPickerItem[] = [
    {
      label: '$(edit) Custom Color...',
      description: 'Enter a hex color code',
      isCustom: true,
    },
    {
      label: '',
      kind: vscode.QuickPickItemKind.Separator,
    },
    ...colorPresets.map((preset) => ({
      label: `${preset.emoji} ${preset.name}`,
      description: preset.color,
      detail: preset.color === currentColor ? '$(check) Current' : undefined,
      color: preset.color,
    })),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Select a color for "${statusName}"`,
    title: `Current color: ${currentColor}`,
  });

  if (!selected) {
    return undefined;
  }

  if (selected.isCustom) {
    const colorInput = await vscode.window.showInputBox({
      title: `Set custom color for "${statusName}"`,
      prompt: 'Enter a hex color (e.g., #1f77b4)',
      value: currentColor,
      validateInput: (value) => {
        const hexPattern = /^#[0-9A-Fa-f]{6}$/;
        if (!hexPattern.test(value)) {
          return 'Please enter a valid hex color (e.g., #1f77b4)';
        }
        return null;
      },
    });
    return colorInput;
  }

  return selected.color;
}
