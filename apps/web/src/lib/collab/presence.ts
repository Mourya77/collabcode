/** A user currently present in the live document, derived from Yjs Awareness. */
export interface LiveUser {
  /** Yjs awareness client id (unique per connection). */
  clientId: number;
  userId: string;
  name: string;
  /** Stable colour for this user (see lib/collab/colors). */
  color: string;
  isSelf: boolean;
}
