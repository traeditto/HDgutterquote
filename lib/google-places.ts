import "server-only"

type GoogleAddressComponent = {
  longText?: string
  shortText?: string
  types?: string[]
}

type GooglePlaceDetails = {
  id?: string
  formattedAddress?: string
  addressComponents?: GoogleAddressComponent[]
}

type GoogleAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string
      text?: { text?: string }
      structuredFormat?: {
        mainText?: { text?: string }
        secondaryText?: { text?: string }
      }
    }
  }>
}

export type AddressSuggestion = {
  placeId: string
  text: string
  mainText: string
  secondaryText: string
}

function apiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) throw new Error("Google address lookup is not configured.")
  return key
}

async function googleResponse<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({})) as T & { error?: { message?: string } }
  if (!response.ok) {
    const reason = result.error?.message ? ` ${result.error.message}` : ""
    throw new Error(`Google could not verify the address.${reason}`)
  }
  return result
}

export async function autocompleteGoogleAddresses(input: string, sessionToken: string): Promise<AddressSuggestion[]> {
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": [
        "suggestions.placePrediction.placeId",
        "suggestions.placePrediction.text.text",
        "suggestions.placePrediction.structuredFormat.mainText.text",
        "suggestions.placePrediction.structuredFormat.secondaryText.text",
      ].join(","),
    },
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: ["us"],
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      languageCode: "en",
      regionCode: "us",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  })
  const result = await googleResponse<GoogleAutocompleteResponse>(response)

  return (result.suggestions ?? []).flatMap(({ placePrediction }) => {
    const placeId = placePrediction?.placeId
    const text = placePrediction?.text?.text
    if (!placeId || !text) return []
    return [{
      placeId,
      text,
      mainText: placePrediction.structuredFormat?.mainText?.text || text,
      secondaryText: placePrediction.structuredFormat?.secondaryText?.text || "",
    }]
  })
}

function component(details: GooglePlaceDetails, type: string) {
  return details.addressComponents?.find((item) => item.types?.includes(type))
}

export async function resolveGoogleAddress(placeId: string, sessionToken: string) {
  const query = new URLSearchParams({ languageCode: "en", regionCode: "us", sessionToken })
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${query}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "id,formattedAddress,addressComponents",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  })
  const details = await googleResponse<GooglePlaceDetails>(response)
  const country = component(details, "country")?.shortText
  const state = component(details, "administrative_area_level_1")?.shortText
  const county = component(details, "administrative_area_level_2")?.longText

  if (country !== "US" || !details.id || !details.formattedAddress || !state || !county) {
    throw new Error("Select a complete United States property address from the Google suggestions.")
  }

  return {
    placeId: details.id,
    formattedAddress: details.formattedAddress,
    state: state.toUpperCase(),
    county,
  }
}
