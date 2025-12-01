export const colors = [
    '#1f77b4', // blue
    '#ff7f0e', // orange
    '#2ca02c', // green
    '#d62728', // red
    '#9467bd', // purple
    '#8c564b'  // brown
];

export const unknownColor = '#999999';

/**
 * Color presets with friendly names and emoji for the color picker.
 * Using colored circle/square emojis for visual preview.
 */
export const colorPresets: readonly { readonly name: string; readonly color: string; readonly emoji: string }[] = [
    { name: 'Blue', color: '#1f77b4', emoji: '🔵' },
    { name: 'Orange', color: '#ff7f0e', emoji: '🟠' },
    { name: 'Green', color: '#2ca02c', emoji: '🟢' },
    { name: 'Red', color: '#d62728', emoji: '🔴' },
    { name: 'Purple', color: '#9467bd', emoji: '🟣' },
    { name: 'Brown', color: '#8c564b', emoji: '🟤' },
    { name: 'Teal', color: '#17becf', emoji: '🩵' },
    { name: 'Pink', color: '#e377c2', emoji: '🩷' },
    { name: 'Lime', color: '#bcbd22', emoji: '🟡' },
    { name: 'Gray', color: '#7f7f7f', emoji: '⚪' },
    { name: 'Navy', color: '#1a3a5c', emoji: '🔷' },
    { name: 'Gold', color: '#d4af37', emoji: '🟡' },
    { name: 'Coral', color: '#ff6b6b', emoji: '🔴' },
    { name: 'Cyan', color: '#00bcd4', emoji: '🩵' },
    { name: 'Indigo', color: '#3f51b5', emoji: '🔵' },
    { name: 'Black', color: '#000000', emoji: '⚫' },
    { name: 'White', color: '#ffffff', emoji: '⬜' },
    // Agility-specific color names
    { name: 'Fuchsia', color: '#ff00ff', emoji: '🟣' },
    { name: 'Magenta', color: '#ff00ff', emoji: '🟣' },
    { name: 'Aqua', color: '#00ffff', emoji: '🩵' },
    { name: 'Yellow', color: '#ffff00', emoji: '🟡' },
    { name: 'Olive', color: '#808000', emoji: '🟢' },
    { name: 'Maroon', color: '#800000', emoji: '🔴' },
    { name: 'Silver', color: '#c0c0c0', emoji: '⚪' },
] as const;

/**
 * Mapping of Agility ColorName values to hex colors.
 * These are the official Digital.ai Agility color names from the documentation.
 */
export const agilityColorNameToHex: Record<string, string> = {
    // Row 1
    'watermelon': '#e91e63',
    'fuschia': '#e91eb3',
    'fuchsia': '#e91eb3', // Alternative spelling
    'wisteria': '#9c27b0',
    'denim': '#2196f3',
    'marine': '#00bcd4',
    'seafoam': '#4dd0e1',
    
    // Row 2
    'tumbleweed': '#ff9800',
    'paper': '#ffffff',
    'strawberry': '#f44336',
    'plum': '#9c27b0',
    'eggplant': '#673ab7',
    'indigo': '#3f51b5',
    
    // Row 3
    'cerulean': '#03a9f4',
    'corulean': '#03a9f4', // Common misspelling
    'jungle': '#4caf50',
    'beaver': '#795548',
    'obsidian': '#424242',
    'lime': '#cddc39',
    'spring': '#c0ca33',
    
    // Row 4
    'dandelion': '#ffeb3b',
    'mango': '#ff9800',
    'tangerine': '#ff5722',
    'mahogany': '#b71c1c',
    'dove': '#9e9e9e',
    'shadow': '#757575',
    
    // Row 5
    'fern': '#8bc34a',
    'shamrock': '#00c853',
    'sunglow': '#ffc107',
    'copper': '#00897b',
    'sunset': '#ff5722',
    'mulberry': '#880e4f',
    
    // Row 6
    'pewter': '#eceff1',
    'iron': '#607d8b',
};

/**
 * Converts an Agility ColorName to a hex color.
 * Falls back to unknownColor if not found.
 */
export function agilityColorToHex(colorName: string | undefined | null): string {
    if (!colorName) {
        return unknownColor;
    }
    const normalized = colorName.toLowerCase().trim();
    return agilityColorNameToHex[normalized] ?? unknownColor;
}

/**
 * Gets the emoji for an Agility color name.
 */
export function agilityColorToEmoji(colorName: string | undefined | null): string {
    const hex = agilityColorToHex(colorName);
    const preset = colorPresets.find((p) => p.color.toLowerCase() === hex.toLowerCase());
    if (preset) {
        return preset.emoji;
    }
    // Find closest color
    return getClosestColorEmoji(hex);
}

/**
 * Gets the closest emoji for a hex color.
 */
function getClosestColorEmoji(hexColor: string): string {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    let closestPreset = colorPresets[0];
    let minDistance = Infinity;

    for (const preset of colorPresets) {
        const pHex = preset.color.replace('#', '');
        const pR = parseInt(pHex.substring(0, 2), 16);
        const pG = parseInt(pHex.substring(2, 4), 16);
        const pB = parseInt(pHex.substring(4, 6), 16);

        const distance = Math.sqrt(
            Math.pow(r - pR, 2) + Math.pow(g - pG, 2) + Math.pow(b - pB, 2)
        );

        if (distance < minDistance) {
            minDistance = distance;
            closestPreset = preset;
        }
    }

    return closestPreset.emoji;
}
