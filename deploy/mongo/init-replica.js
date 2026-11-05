/* global rs, print */
// OPS-03: create the replica set once. Idempotent. Run by deploy/mongo/init-replica.sh as root.
let status = 0;
try {
  status = rs.status().ok;
} catch {
  status = 0; // not initiated yet
}
if (status !== 1) {
  rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
  print('replica set rs0 initiated');
} else {
  print('replica set rs0 already exists');
}
