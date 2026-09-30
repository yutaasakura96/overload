import { v7 } from 'uuid';

/** A new row's id, made on the device so a retried create lands once (docs/04, Conventions). */
export const newId = () => v7();
