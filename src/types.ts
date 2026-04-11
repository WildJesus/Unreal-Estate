// Shared types for Srealitky Universes extension

export interface AffordabilityRatio {
  year: number;
  /** median_property_price / median_salary */
  ratio: number;
}

export interface Universe {
  id: string;
  label: string;
  /** The affordability ratio for this universe */
  affordabilityRatio: AffordabilityRatio;
}

// Placeholder — transformation logic goes elsewhere
