/**
 * Testes — constantes de manutenção CRM.
 * Uso: node scripts/test-crm-maintenance.js
 */
const assert = require("assert")
const {
  CRM_DELIVERY_RETENTION_DAYS,
  CRM_MESSAGE_RETENTION_DAYS,
  CRM_FLOW_RUN_RETENTION_DAYS,
} = require("../src/lib/crmMaintenance")

console.log("\ncrm-maintenance — testes\n")

assert.ok(CRM_DELIVERY_RETENTION_DAYS >= 1 && CRM_DELIVERY_RETENTION_DAYS <= 90)
assert.ok(CRM_MESSAGE_RETENTION_DAYS >= 0)
assert.ok(CRM_FLOW_RUN_RETENTION_DAYS >= 0)
console.log("  ✓ constantes de retenção válidas")
console.log(`    delivery=${CRM_DELIVERY_RETENTION_DAYS}d message=${CRM_MESSAGE_RETENTION_DAYS}d flowRun=${CRM_FLOW_RUN_RETENTION_DAYS}d`)
console.log("\n1 passou\n")
