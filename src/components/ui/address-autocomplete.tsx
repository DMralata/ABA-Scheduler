"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Minimal types for the Google Maps Places API (avoids requiring @types/google.maps)
interface PlaceResult {
  address_components?: AddressComponent[];
  geometry?: { location: { lat(): number; lng(): number } };
  formatted_address?: string;
}
interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}
interface Autocomplete {
  addListener(event: string, handler: () => void): void;
  getPlace(): PlaceResult;
}
declare global {
  interface Window {
    google?: {
      maps: {
        places: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: object
          ) => Autocomplete;
        };
      };
    };
  }
}

interface AddressAutocompleteProps {
  defaultStreet?: string | null;
  defaultCity?: string | null;
  defaultState?: string | null;
  defaultZip?: string | null;
  defaultLatitude?: number | null;
  defaultLongitude?: number | null;
}

function getComponent(
  components: AddressComponent[],
  type: string,
  nameKey: "long_name" | "short_name" = "long_name"
): string {
  return components.find((c) => c.types.includes(type))?.[nameKey] ?? "";
}

let scriptLoading = false;
let scriptLoaded = false;
let scriptFailed = false;
const onLoadCallbacks: Array<() => void> = [];

function loadGoogleMapsScript(onLoad: () => void) {
  // No-op if Maps is disabled or the key is missing — keep address fields editable as plain inputs.
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || scriptFailed) return;

  if (scriptLoaded) {
    onLoad();
    return;
  }
  onLoadCallbacks.push(onLoad);
  if (scriptLoading) return;

  scriptLoading = true;
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
  script.async = true;
  script.onload = () => {
    scriptLoaded = true;
    scriptLoading = false;
    onLoadCallbacks.forEach((cb) => cb());
    onLoadCallbacks.length = 0;
  };
  script.onerror = () => {
    scriptFailed = true;
    scriptLoading = false;
    onLoadCallbacks.length = 0;
  };
  document.head.appendChild(script);
}

export function AddressAutocomplete({
  defaultStreet,
  defaultCity,
  defaultState,
  defaultZip,
  defaultLatitude,
  defaultLongitude,
}: AddressAutocompleteProps) {
  const streetRef = useRef<HTMLInputElement>(null);
  const [city, setCity] = useState(defaultCity ?? "");
  const [state, setState] = useState(defaultState ?? "");
  const [zip, setZip] = useState(defaultZip ?? "");
  const [lat, setLat] = useState<number | null>(defaultLatitude ?? null);
  const [lng, setLng] = useState<number | null>(defaultLongitude ?? null);

  useEffect(() => {
    loadGoogleMapsScript(() => {
      const input = streetRef.current;
      if (!input || !window.google) return;

      const autocomplete = new window.google.maps.places.Autocomplete(input, {
        types: ["address"],
        componentRestrictions: { country: "us" },
        fields: ["address_components", "geometry"],
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        const components = place.address_components ?? [];

        const streetNumber = getComponent(components, "street_number");
        const route = getComponent(components, "route");
        const street = [streetNumber, route].filter(Boolean).join(" ");

        setCity(getComponent(components, "locality"));
        setState(getComponent(components, "administrative_area_level_1", "short_name"));
        setZip(getComponent(components, "postal_code"));
        setLat(place.geometry?.location.lat() ?? null);
        setLng(place.geometry?.location.lng() ?? null);

        // Update the street input value (Autocomplete fills the full address by default)
        if (streetRef.current) {
          streetRef.current.value = street;
        }
      });
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="street">Street</Label>
        <Input
          ref={streetRef}
          id="street"
          name="street"
          defaultValue={defaultStreet ?? ""}
          placeholder="Start typing an address…"
          autoComplete="off"
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-1 space-y-1.5">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            name="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="state">State</Label>
          <Input
            id="state"
            name="state"
            maxLength={2}
            placeholder="OR"
            value={state}
            onChange={(e) => setState(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="zip">ZIP</Label>
          <Input
            id="zip"
            name="zip"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
          />
        </div>
      </div>
      {/* Hidden inputs carry lat/lng through FormData */}
      <input type="hidden" name="latitude" value={lat ?? ""} />
      <input type="hidden" name="longitude" value={lng ?? ""} />
    </div>
  );
}
