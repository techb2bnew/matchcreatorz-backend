'use strict';
const svc       = require('../../services/admin/report.service');
const { toCsv } = require('../../helpers/csv.helper');
const response  = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   - name: Admin - Reports
 *     description: Business analytics reports (revenue, bookings, users, sellers, wallet, connects) with CSV export
 */

/**
 * @swagger
 * /api/v1/admin/reports/types:
 *   get:
 *     summary: List available report types
 *     tags: [Admin - Reports]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Report type metadata (key, label, description)
 */
exports.listReportTypes = async (req, res) => {
  return response.success(res, 'Report types fetched', svc.listTypes());
};

/**
 * @swagger
 * /api/v1/admin/reports/{type}:
 *   get:
 *     summary: Get a report for a date range (summary + chart + table rows)
 *     tags: [Admin - Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string, enum: [revenue, bookings, users, sellers, wallet, connects] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *         description: "YYYY-MM-DD — defaults to 30 days before `to`"
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *         description: "YYYY-MM-DD — defaults to today"
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Filters table rows by the report's text-searchable columns (varies per type)
 *     responses:
 *       200:
 *         description: "{ summary, chart, columns, rows, truncated }"
 *       400:
 *         description: Unknown report type
 */
exports.getReport = async (req, res, next) => {
  try {
    const data = await svc.getReport(req.params.type, req.query);
    return response.success(res, 'Report fetched', data);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/reports/{type}/export:
 *   get:
 *     summary: Export a report as CSV
 *     tags: [Admin - Reports]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string, enum: [revenue, bookings, users, sellers, wallet, connects] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema: { type: string, format: binary }
 */
exports.exportReport = async (req, res, next) => {
  try {
    const { columns, rows } = await svc.getReport(req.params.type, req.query);
    const csv = toCsv(columns, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-report.csv"`);
    return res.send(csv);
  } catch (err) { next(err); }
};
