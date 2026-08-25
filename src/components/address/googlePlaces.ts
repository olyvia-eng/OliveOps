import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import type { Address } from '../../types';

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();

let placesLibraryPromise: Promise<google.maps.PlacesLibrary> | null = null;

export const isGooglePlacesConfigured = Boolean(apiKey);

export function loadGooglePlaces(): Promise<google.maps.PlacesLibrary> | null {
  if (!apiKey) return null;

  if (!placesLibraryPromise) {
    setOptions({ key: apiKey, v: 'weekly', language: 'en', region: 'CA' });
    placesLibraryPromise = importLibrary('places');
  }

  return placesLibraryPromise;
}

function componentValue(
  components: google.maps.places.AddressComponent[],
  types: string[],
  format: 'longText' | 'shortText' = 'longText'
): string {
  const component = components.find((candidate) => types.some((type) => candidate.types.includes(type)));
  return component?.[format] ?? '';
}

export function parseGoogleAddress(components: google.maps.places.AddressComponent[]): Address {
  const streetNumber = componentValue(components, ['street_number']);
  const route = componentValue(components, ['route']);
  const postalCode = componentValue(components, ['postal_code']);
  const postalCodeSuffix = componentValue(components, ['postal_code_suffix']);

  return {
    street: [streetNumber, route].filter(Boolean).join(' '),
    city: componentValue(components, ['locality', 'postal_town', 'sublocality_level_1']),
    province: componentValue(components, ['administrative_area_level_1']),
    postalCode: [postalCode, postalCodeSuffix].filter(Boolean).join('-'),
    country: componentValue(components, ['country']) || 'Canada',
  };
}