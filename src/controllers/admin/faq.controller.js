'use strict';
const { Op } = require('sequelize');
const { Faq } = require('../../models');
const response = require('../../helpers/response.helper');

/**
 * @swagger
 * tags:
 *   name: Admin - FAQ
 *   description: Manage FAQ question/answer pairs shown on the public FAQ page
 *
 * /api/v1/admin/faqs:
 *   get:
 *     summary: List all FAQs, in display order
 *     tags: [Admin - FAQ]
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: All FAQs } }
 */
exports.listFaqs = async (req, res, next) => {
  try {
    const faqs = await Faq.findAll({ order: [['position', 'ASC'], ['id', 'ASC']] });
    return response.success(res, 'FAQs fetched', faqs);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/faqs:
 *   post:
 *     summary: Add a new FAQ (appended to the end of the list)
 *     tags: [Admin - FAQ]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [question, answer]
 *             properties:
 *               question: { type: string }
 *               answer:   { type: string }
 *     responses:
 *       201: { description: FAQ created }
 *       400: { description: Question and answer are required }
 */
exports.addFaq = async (req, res, next) => {
  try {
    const { question, answer } = req.body;
    if (!question?.trim() || !answer?.trim())
      return response.badRequest(res, 'Question and answer are required');

    const last = await Faq.findOne({ order: [['position', 'DESC']] });
    const faq = await Faq.create({
      question: question.trim(),
      answer:   answer.trim(),
      position: last ? last.position + 1 : 0,
    });
    return response.created(res, 'FAQ created successfully', faq);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/faqs/{id}:
 *   put:
 *     summary: Edit a FAQ's question/answer (or move it via position)
 *     tags: [Admin - FAQ]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               question: { type: string }
 *               answer:   { type: string }
 *               position: { type: integer }
 *     responses:
 *       200: { description: FAQ updated }
 *       404: { description: FAQ not found }
 */
exports.editFaq = async (req, res, next) => {
  try {
    const faq = await Faq.findByPk(req.params.id);
    if (!faq) return response.notFound(res, 'FAQ not found');

    const { question, answer, position } = req.body;
    await faq.update({
      ...(question !== undefined && { question: question.trim() }),
      ...(answer   !== undefined && { answer: answer.trim() }),
      ...(position !== undefined && { position: Number(position) }),
    });
    return response.success(res, 'FAQ updated successfully', faq);
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/faqs/{id}:
 *   delete:
 *     summary: Delete a FAQ
 *     tags: [Admin - FAQ]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
 *     responses:
 *       200: { description: FAQ deleted }
 *       404: { description: FAQ not found }
 */
exports.deleteFaq = async (req, res, next) => {
  try {
    const faq = await Faq.findByPk(req.params.id);
    if (!faq) return response.notFound(res, 'FAQ not found');
    await faq.destroy();
    return response.success(res, 'FAQ deleted successfully', { deleted: true });
  } catch (err) { next(err); }
};

/**
 * @swagger
 * /api/v1/admin/faqs/{id}/move:
 *   patch:
 *     summary: Swap this FAQ's position with the one above or below it
 *     tags: [Admin - FAQ]
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [direction]
 *             properties:
 *               direction: { type: string, enum: [up, down] }
 *     responses:
 *       200: { description: Reordered }
 *       404: { description: FAQ not found }
 */
exports.moveFaq = async (req, res, next) => {
  try {
    const faq = await Faq.findByPk(req.params.id);
    if (!faq) return response.notFound(res, 'FAQ not found');

    const { direction } = req.body;
    const isUp = direction === 'up';
    const neighbor = await Faq.findOne({
      where: { position: { [isUp ? Op.lt : Op.gt]: faq.position } },
      order: [['position', isUp ? 'DESC' : 'ASC']],
    });
    if (!neighbor) return response.success(res, 'Already at the edge', faq);

    const a = faq.position, b = neighbor.position;
    await faq.update({ position: b });
    await neighbor.update({ position: a });
    return response.success(res, 'Reordered', faq);
  } catch (err) { next(err); }
};
