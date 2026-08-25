import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, MapPin } from 'lucide-react';
import type { Address } from '../../types';
import { isGooglePlacesConfigured, loadGooglePlaces, parseGoogleAddress } from './googlePlaces';

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onAddressSelect: (address: Address) => void;
}

interface MenuPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
}

const MIN_QUERY_LENGTH = 3;
const REQUEST_DELAY_MS = 300;

export default function AddressAutocomplete({ value, onChange, onAddressSelect }: AddressAutocompleteProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const requestIdRef = useRef(0);
  const [suggestions, setSuggestions] = useState<google.maps.places.PlacePrediction[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const menuOpen = focused && suggestions.length > 0;

  useEffect(() => {
    const query = value.trim();
    const requestId = ++requestIdRef.current;

    if (!isGooglePlacesConfigured || query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const places = await loadGooglePlaces();
        if (!places || requestId !== requestIdRef.current) return;

        sessionTokenRef.current ??= new places.AutocompleteSessionToken();
        const response = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          includedRegionCodes: ['ca'],
          sessionToken: sessionTokenRef.current,
        });

        if (requestId !== requestIdRef.current) return;
        setSuggestions(response.suggestions.flatMap((suggestion) => (
          suggestion.placePrediction ? [suggestion.placePrediction] : []
        )));
        setActiveIndex(-1);
      } catch {
        if (requestId === requestIdRef.current) setSuggestions([]);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, REQUEST_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [value]);

  useEffect(() => {
    if (!menuOpen) {
      setMenuPosition(null);
      return;
    }

    const positionMenu = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;

      const spaceBelow = window.innerHeight - rect.bottom;
      const openAbove = spaceBelow < 240 && rect.top > spaceBelow;
      setMenuPosition({
        left: rect.left,
        width: rect.width,
        ...(openAbove
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      });
    };

    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!inputRef.current?.contains(target) && !menuRef.current?.contains(target)) setFocused(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, []);

  const selectSuggestion = async (prediction: google.maps.places.PlacePrediction) => {
    setFocused(false);
    setSuggestions([]);
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ['addressComponents'] });
      if (place.addressComponents?.length) onAddressSelect(parseGoogleAddress(place.addressComponents));
    } catch {
      onChange(prediction.text.text);
    } finally {
      sessionTokenRef.current = null;
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
    setFocused(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!menuOpen) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      void selectSuggestion(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      setFocused(false);
    }
  };

  const menu = menuOpen && menuPosition ? createPortal(
    <div
      ref={menuRef}
      id={`${id}-suggestions`}
      role="listbox"
      className="fixed z-[70] max-h-64 overflow-y-auto rounded-lg border border-brand-100 bg-white py-1 shadow-xl dark:border-brand-600 dark:bg-brand-700"
      style={menuPosition}
    >
      {suggestions.map((prediction, index) => (
        <button
          key={prediction.placeId}
          id={`${id}-suggestion-${index}`}
          type="button"
          role="option"
          aria-selected={activeIndex === index}
          className={`flex w-full items-start gap-2 px-3 py-2 text-left ${activeIndex === index ? 'bg-accent-50 dark:bg-brand-600' : 'hover:bg-gray-50 dark:hover:bg-brand-600'}`}
          onPointerDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => void selectSuggestion(prediction)}
        >
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-brand-900 dark:text-brand-50">
              {prediction.mainText?.text ?? prediction.text.text}
            </span>
            {prediction.secondaryText && (
              <span className="block truncate text-xs text-gray-500 dark:text-brand-200">{prediction.secondaryText.text}</span>
            )}
          </span>
        </button>
      ))}
      <div className="border-t border-brand-100 px-3 py-1.5 text-right text-[10px] font-medium text-gray-400 dark:border-brand-600 dark:text-brand-300">
        Powered by Google
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-sm font-medium text-gray-700 dark:text-brand-200">Address</label>
      <div className="relative">
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          autoComplete="off"
          value={value}
          placeholder="Start typing a Canadian address"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={menuOpen ? `${id}-suggestions` : undefined}
          aria-expanded={menuOpen}
          aria-activedescendant={activeIndex >= 0 ? `${id}-suggestion-${activeIndex}` : undefined}
          className="h-10 w-full rounded-xl border border-brand-100 bg-white px-3 pr-9 text-sm text-brand-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/40 dark:border-brand-600 dark:bg-brand-700 dark:text-brand-50"
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
        />
        {loading && <LoaderCircle className="absolute right-3 top-3 h-4 w-4 animate-spin text-gray-400" aria-label="Finding addresses" />}
      </div>
      {menu}
    </div>
  );
}