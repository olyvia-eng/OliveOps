import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('CRM uses one autocomplete boundary for every editable property address', async () => {
  const crm = await read('../src/pages/crm/CRMPage.tsx');

  assert.match(crm, /form\.properties\.map/);
  assert.match(crm, /<AddressAutocomplete/);
  assert.match(crm, /onChange=\{\(value\) => setProperty\(index, 'street', value\)\}/);
  assert.match(crm, /onAddressSelect=\{\(address\) => setPropertyAddress\(index, address\)\}/);
  assert.match(crm, /propertyIndex === index \? \{ \.\.\.property, \.\.\.address \} : property/);
  assert.doesNotMatch(crm, /latitude|longitude|placeId/);
});

test('autocomplete delays current Places requests and limits suggestions to Canada', async () => {
  const source = await read('../src/components/address/AddressAutocomplete.tsx');

  assert.match(source, /MIN_QUERY_LENGTH = 3/);
  assert.match(source, /REQUEST_DELAY_MS = 300/);
  assert.match(source, /query\.length < MIN_QUERY_LENGTH/);
  assert.match(source, /AutocompleteSuggestion\.fetchAutocompleteSuggestions/);
  assert.match(source, /includedRegionCodes: \['ca'\]/);
  assert.match(source, /sessionToken: sessionTokenRef\.current/);
  assert.match(source, /requestId !== requestIdRef\.current/);
  assert.doesNotMatch(source, /AutocompleteService/);
});

test('place details are fetched only after selection and populate structured fields', async () => {
  const [component, places] = await Promise.all([
    read('../src/components/address/AddressAutocomplete.tsx'),
    read('../src/components/address/googlePlaces.ts'),
  ]);

  assert.match(component, /prediction\.toPlace\(\)/);
  assert.match(component, /fetchFields\(\{ fields: \['addressComponents'\] \}\)/);
  assert.match(component, /parseGoogleAddress\(place\.addressComponents\)/);
  assert.match(places, /street: \[streetNumber, route\]/);
  assert.match(places, /city: componentValue\(components, \['locality', 'postal_town', 'sublocality_level_1'\]\)/);
  assert.match(places, /province: componentValue\(components, \['administrative_area_level_1'\]\)/);
  assert.match(places, /postalCode: \[postalCode, postalCodeSuffix\]/);
  assert.match(places, /country: componentValue\(components, \['country'\]\) \|\| 'Canada'/);
});

test('autocomplete remains a manual input without Google and escapes modal clipping', async () => {
  const [component, places] = await Promise.all([
    read('../src/components/address/AddressAutocomplete.tsx'),
    read('../src/components/address/googlePlaces.ts'),
  ]);

  assert.match(component, /onChange\(event\.target\.value\)/);
  assert.match(component, /createPortal\([\s\S]*document\.body/);
  assert.match(component, /role="combobox"/);
  assert.match(component, /event\.key === 'ArrowDown'/);
  assert.match(component, /event\.key === 'Escape'/);
  assert.match(component, /catch \{[\s\S]*setSuggestions\(\[\]\)/);
  assert.match(places, /if \(!apiKey\) return null/);
  assert.match(places, /import\.meta\.env\.VITE_GOOGLE_MAPS_API_KEY/);
  assert.doesNotMatch(places, /AIza[0-9A-Za-z_-]{20,}/);
});
