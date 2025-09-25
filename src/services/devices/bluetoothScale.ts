export async function connectScale(): Promise<boolean> {
  // TODO: implement native BLE scan/bind
  return Promise.resolve(true);
}

export async function readWeightOnce(): Promise<number> {
  // TODO: read from connected scale
  return Promise.resolve(0); // grams or chosen unit
}
