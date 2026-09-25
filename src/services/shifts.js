async function withTotals(client, shift) {
  if (!shift) return null;
  const sales = (
    await client.query(
      `SELECT COALESCE(SUM(amount),0) AS total,COALESCE(SUM(amount) FILTER(WHERE method='cash'),0) AS cash,COALESCE(SUM(amount) FILTER(WHERE method='card'),0) AS card,COALESCE(SUM(amount) FILTER(WHERE method='online'),0) AS online FROM payments WHERE shift_id=$1`,
      [shift.id],
    )
  ).rows[0];
  const refunds = (
    await client.query(
      `SELECT COALESCE(SUM(amount),0) AS total,COALESCE(SUM(amount) FILTER(WHERE method='cash'),0) AS cash FROM refunds WHERE shift_id=$1`,
      [shift.id],
    )
  ).rows[0];
  for (const key of Object.keys(sales)) sales[key] = Number(sales[key]);
  for (const key of Object.keys(refunds)) refunds[key] = Number(refunds[key]);
  const expected_cash =
    Math.round((Number(shift.opening_cash) + sales.cash - refunds.cash) * 100) / 100;
  return {
    ...shift,
    sales,
    refunds,
    net: Math.round((sales.total - refunds.total) * 100) / 100,
    expected_cash,
    difference:
      shift.closing_cash === null
        ? null
        : Math.round((Number(shift.closing_cash) - expected_cash) * 100) / 100,
  };
}
module.exports = { withTotals };
