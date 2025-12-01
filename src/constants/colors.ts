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
 * Color presets with friendly names for the color picker
 */
export const colorPresets: readonly { readonly name: string; readonly color: string }[] = [
    { name: 'Blue', color: '#1f77b4' },
    { name: 'Orange', color: '#ff7f0e' },
    { name: 'Green', color: '#2ca02c' },
    { name: 'Red', color: '#d62728' },
    { name: 'Purple', color: '#9467bd' },
    { name: 'Brown', color: '#8c564b' },
    { name: 'Teal', color: '#17becf' },
    { name: 'Pink', color: '#e377c2' },
    { name: 'Lime', color: '#bcbd22' },
    { name: 'Gray', color: '#7f7f7f' },
    { name: 'Navy', color: '#1a3a5c' },
    { name: 'Gold', color: '#d4af37' },
    { name: 'Coral', color: '#ff6b6b' },
    { name: 'Cyan', color: '#00bcd4' },
    { name: 'Indigo', color: '#3f51b5' },
] as const;
