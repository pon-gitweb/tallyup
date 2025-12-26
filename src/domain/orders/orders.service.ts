/**
 * Orders domain public API.
 * During migration, we wrap existing implementations here.
 * Screens should import from `src/domain/orders` eventually.
 */
import { runAISuggest as runAISuggestLegacy } from '../../services/orders/suggestAI';

export const OrdersService = {
  runAISuggest: runAISuggestLegacy,
};
