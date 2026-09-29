import { E2E_EMAIL, apiFixture } from './fixture';

export default function globalTeardown() {
  apiFixture('delete', E2E_EMAIL);
}
