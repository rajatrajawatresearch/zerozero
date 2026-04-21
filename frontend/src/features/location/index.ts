/**
 * Public surface of the Location feature.
 *
 * Other features (notably Agent 10's header) and the app router import from
 * here — internal files (`./api`, `./hooks`, `./components/*`) are considered
 * private. Keep this barrel intentional: only re-export what other slices
 * genuinely need to consume.
 */

/* -------------------------------------------------------------------------- */
/*                                 Routes                                     */
/* -------------------------------------------------------------------------- */
export { locationRoutes } from './routes';

/* -------------------------------------------------------------------------- */
/*                               Components                                   */
/* -------------------------------------------------------------------------- */
export { LocationTrigger } from './components/LocationTrigger';
export { LocationPicker } from './components/LocationPicker';
export { AddressForm } from './components/AddressForm';
export { AddressList } from './components/AddressList';
export { MapPreview } from './components/MapPreview';
export { UseMyLocationButton } from './components/UseMyLocationButton';

/* -------------------------------------------------------------------------- */
/*                                   Hooks                                    */
/* -------------------------------------------------------------------------- */
export { useGeolocation, useDebouncedValue } from './hooks';
export type { GeolocationResult, GeolocationErrorCode } from './hooks';
export { GeolocationError } from './hooks';

/* -------------------------------------------------------------------------- */
/*                                 API hooks                                  */
/* -------------------------------------------------------------------------- */
export {
  useGeoSearchQuery,
  useGeoReverseQuery,
  useAddressesQuery,
  useCreateAddressMutation,
  useUpdateAddressMutation,
  useDeleteAddressMutation,
  useSetDefaultAddressMutation,
} from './api';

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */
export type { Place, Address, AddressIn, AddressPatch } from './types';
