'use strict';
// One-off seed: creates 8 broad top-level categories (mirroring a
// Upwork-style "Type of work" taxonomy) and populates each with its
// specific-skill subcategories. Existing "Designer"/"Development" categories
// are left untouched (services already reference them by id) — these are
// added as new, additional top-level categories alongside them.
//
// Idempotent: safe to re-run — uses findOrCreate keyed on the globally-unique
// `name` column, so nothing is duplicated on a second run.
require('dotenv').config();
const { Category } = require('../models');

const PARENTS = [
  { name: 'Development & IT',        icon: '💻' },
  { name: 'Design & Creative',       icon: '🎨' },
  { name: 'Finance & Accounting',    icon: '💰' },
  { name: 'Admin & Customer Support', icon: '🎧' },
  { name: 'Engineering & Architecture', icon: '🏗️' },
  { name: 'Legal',                   icon: '⚖️' },
  { name: 'Sales & Marketing',       icon: '📣' },
  { name: 'Writing & Translation',   icon: '✍️' },
];

const SUBCATEGORIES = {
  'Development & IT': [
    'Apple Xcode Specialist', 'Amazon EC2 Specialist', 'Android App Developer', 'Alexa Skill Kit Specialist',
    'Android Studio Freelancer', 'ASP.NET Developer', 'Apache Spark Specialist', 'AWS Developer',
    'Artificial Intelligence Engineer', 'ArcGIS Developer', 'Blockchain Developer', 'Babylon.js Freelancer',
    'BigQuery Developer', 'Bot Developer', 'Computer Engineer', 'Chatbot Developer', 'CSS Developer',
    'Cloud Computing Specialist', 'Chrome Extension Developer', 'CodeIgniter Developer', 'C# Developers & Programmer',
    'C++ Programmers & Developer', 'Computer Vision Engineer', 'Data Scraper', 'Database Design and Construction Freelancer',
    'Django Freelancer', 'Data Extraction Specialist', 'Data Visualization Specialist', 'Database Designer',
    'Data Miner', 'Deep Learning Expert', 'Data Analyst', 'Data Scientist', 'd3.js Developer', 'DevOps Engineer',
    'Docker Specialist', 'Delphi Developer', 'Data Cleansing Analyst', 'Data analytics Freelancer', 'Error Detection Freelancer',
    'Elementor Freelancer', 'ERPNext Specialist', 'Erlang Developers & Programmer', 'FFmpeg Specialist', 'Flutter Developer',
    'Front-End Developer', 'Genesis Framework Freelancer', 'Google Apps Script Freelancer', 'Google Cloud Platform Developer',
    'HTML Developer', 'Haskell Developers & Programmer', 'Image/Object Recognition Freelancer', 'iOS Developer',
    'Information Security Analyst', 'IBM SPSS Specialist', 'iPhone App Developer', 'IT Outsourcing Freelancer',
    'JavaScript Developer', 'Linux Developer', 'Lua Developers & Programmer', 'Microsoft Power BI Specialist',
    'Mobile App Developer', 'Microsoft SQL Server Developer', 'Microsoft Dynamics 365 Freelancer', 'Magento Developer',
    'NopCommerce Developer', 'OCR Tesseract Specialist', 'Ontologist', 'Odoo Specialist', 'Performance Tuner',
    'PyTorch Freelancer', 'Page Speed Optimization Freelancer', 'PHP Developer', 'Python Script Freelancer',
    'PostgreSQL Developers & DBA', 'Python Developer', 'Qt Developer', 'Ruby on Rails Developer', 'React.js Developer',
    'React Native Developer', 'R Developers & Programmer', 'Reverse Engineer', 'Sharepoint Freelancer',
    'Salesforce Lightning Freelancer', 'Salesforce App Developer', 'Sitecore Specialist', 'Selenium Developer',
    'Selenium WebDriver Specialist', 'Smart Contracts Freelancer', 'SQL Developer', 'SAS Specialist', 'Shopify Developer',
    'Software QA Tester', 'SquareSpace Developer', 'SSL Specialist', 'Stata Specialist', 'Statistics Specialist',
    'Shopware Specialist', 'Tableau Consultant', 'Unity3D Freelancer', 'Unity Developer', 'Vulnerability Assessment Specialist',
    'VB.NET Developer', 'Vue.js Developer', 'VBA Developer', 'Website Freelancer', 'WordPress Developer',
    'Website redesign Freelancer', 'Windows PowerShell Developer', 'WebGL Developer', 'Woocommerce Developer',
    'Wordpress Theme Freelancer', 'Webflow Developer', 'WebRTC Developer', 'Web Scraper', 'Website Developer',
    'Web Testing Specialist', 'Web Application Freelancer', 'Web Crawler Developer', 'Web Services Specialist',
    'WiX Specialist', 'Xamarin Specialist', 'YouTube API Developer',
  ],
  'Design & Creative': [
    '3D Visualizations Freelancer', '2D Game Art Freelancer', '3D Modeler', '3D Rendering Artist', '3D Designers & Artist',
    'Adobe After Effects Specialist', 'Adobe InDesign Expert', 'Arts Freelancer', 'Anime Freelancer', 'Actor',
    'Adobe Illustrator Expert', 'Album Cover Designer', 'Adobe Premiere Pro Specialist', 'Adobe Photoshop Expert',
    'Adobe Photoshop Lightroom Specialist', 'Acrylic Painter', 'Audio Production Specialist', 'Audio Editor', 'Audio Mixer',
    'Autodesk Maya Specialist', 'Book Designer', 'Brochure Designer', 'Branding Freelancer', 'Blender3D Specialist',
    'Book Cover Designer', "Children's Book Illustrator", 'Cartographer', 'CorelDRAW Specialist', 'Compositing Specialist',
    'Character Designer', 'Comic Artist', 'Digital Artist', 'Desktop Publishing Specialist', 'Drawer', 'Digital Design Freelancer',
    'Fashion Designer', 'Fashion Illustrator', 'Flyer Designer', 'Figma Freelancer', 'Guitar Family Freelancer',
    'GIF Freelancer', 'Graphic Designer', 'Game Designer', 'Illustrator', 'Interior Designer', 'Jewelry Designer',
    'Logo Freelancer', 'Logo Designer', 'Lyrics Video Freelancer', 'Logo Animation Freelancer', 'Male Voice Over Artist',
    'Music Producer', 'Musical Composition Specialist', 'Medical Illustrator', 'Mobile App Design Freelancer', 'Narrator',
    'Podcasting Specialist', 'Packaging Designer', 'Piano Composition Specialist', 'Photo Editor',
    'Product Photography Freelancer', 'Photographer', 'Presentation Designer', 'Photo Retoucher', 'Portrait Painter',
    'Photorealistic Rendering Freelancer', 'Product Designer', 'Reaper Freelancer', 'Responsive Web Designer',
    'Social Media Design Freelancer', 'Storyboard Freelancer', 'Signage Freelancer', 'Sewing Freelancer', 'Singer',
    'Spine Freelancer', 'SVG Freelancer', 'Sketch Artist', 'Typesetter', 'Textile Design Freelancer', 'UX Designer',
    'UI Designer', 'Visual Design Freelancer', 'Video Editor', 'Videographer', 'Vector Art Freelancer',
    'Voice Acting Freelancer', 'Voice Over American Accent Specialist', 'Vector Illustration Freelancer',
    'VFX Animation Specialist', 'Voice Over Actor', 'Voice Talent', 'Vector Tracing Freelancer', 'Video Producer',
    'Voice Recording Freelancer', 'Whiteboard Animator', 'Web Designer', 'YouTube Freelancer',
  ],
  'Finance & Accounting': [
    'Accountant', 'Bookkeeper', 'Certified Public Accountant', 'Forex Trader', 'Financial Modeler', 'Financial Analyst',
    'ICD Coding Specialist', 'Medical Coders, Biller', 'MQL 4 Specialist', 'QuickBooks Consultant', 'TradeStation Specialist',
    'Tax Preparer', 'Xero Specialist',
  ],
  'Admin & Customer Support': [
    'Adobe Acrobat Expert', 'Airtable Freelancer', 'Administrative Assistant', 'Business Presentation Freelancer',
    'Business Process Modeling Specialist', 'Buying Freelancer', 'Chat Support Specialist', 'Calendar Management Specialist',
    'Catalog Freelancer', 'Cook', 'Career Freelancer', 'Data Entry Specialist', 'Dietitian', 'Excel Freelancer',
    'Email Handler', 'Excel Expert', 'Event Planner', 'Google Sheets Freelancer', 'Microsoft Project Specialist',
    'Medical Freelancer', 'Microsoft Word Expert', 'Medical Transcriptionist', 'Microsoft Excel PowerPivot Specialist',
    'Microsoft Teams Freelancer', 'MS Office 365 Specialist', 'Microsoft Visio Specialist', 'Online Freelancer',
    'Pages Specialist', 'PDF Converter', 'Project Manager', 'PowerPoint Expert', 'PowerPoint Freelancer',
    'Product Upload Freelancer', 'Recruiters & Recruitment Consultant', 'Survey Freelancer', 'Spreadsheets Specialist',
    'Stock Management Specialist', 'Task Coordination Freelancer', 'Technical Support Specialist', 'Transcriptionist',
    'Time Management Specialist', 'Virtual Freelancer', 'Virtual Assistant',
  ],
  'Engineering & Architecture': [
    '3D Printing Expert', '3D CAD Design Freelancer', 'Architectural Rendering Specialist', 'Autodesk Revit Specialist',
    'Arduino Programmer', 'AutoCAD Civil 3D Freelancer', 'Automotive Design Freelancer', 'AutoCAD Specialist',
    'ANSYS Specialist', 'Chemist', 'Chief Architect Specialist', 'Computational Fluid Dynamics (CFD) Specialist',
    'CAD Designer', 'Control Engineering Freelancer', 'Circuit Designer', 'CAD Drafting Freelancer', 'CAD Freelancer',
    'Drafting Specialist', 'Digital Signal Processing Specialist', 'ESP32 Freelancer', 'Electronics Specialist',
    'Engineering Drawing Specialist', 'Electrical Drawing Specialist', 'Estimating Freelancer', 'Electrical Engineer',
    'Estimator Specialist', 'Fusion 360 Specialist', 'Geographic Information System (GIS) Developer', 'Industrial Designer',
    'Injection Mold Design Freelancer', 'Interior Architecture Specialist', 'Landscape Designer', 'LabVIEW Specialist',
    'MATLAB Developer', 'Mechanical Engineer', 'Product Formulation Freelancer', 'PCB Designer', 'Quality Control Freelancer',
    'Raspberry Pi Developer', 'SolidWorks Designer', 'SketchUp Specialist', 'Scientific Researcher', 'Structural Engineer',
    'Verilog / VHDL Specialist', 'Xactimate Specialist',
  ],
  'Legal': [
    'Arbitration Lawyers & Legal Professional', 'Business Law Freelancer', 'Contract Law Lawyers & Legal Professional',
    'Copyright Lawyers & Legal Professional', 'Contract Drafter', 'Criminal Law Lawyers & Legal Professional',
    'Employment Law Lawyers & Legal Professional', 'Family Law Lawyers & Legal Professional',
    'Immigration Law Lawyers & Legal Professional', 'International Law Lawyers & Legal Professional',
    'Intellectual Property Law Lawyers & Legal Professional', 'Legal Freelancer', 'Legal Consultant', 'Legal Researcher',
    'Legal Writer', 'Legal Transcriptionist', 'Legal Assistance Specialist', 'Paralegals Professional',
    'Trademarks Freelancer', 'Tax Law Lawyers & Legal Professional',
  ],
  'Sales & Marketing': [
    'Amazon FBA Specialist', 'Ad Creative Freelancer', 'Amazon Webstore Specialist', 'App Store Specialist',
    'Amazon Seller Central Consultant', 'App Store Optimization (ASO) Specialist', 'Advertising Consultant',
    'Affiliate Marketer', 'Business Coache', 'Contact lists Freelancer', 'CRM Specialist', 'Consultant',
    'Constant Contact Specialist', 'Content Marketer', 'Cold Caller', 'Dropshipper', 'Digital Marketer',
    'eBay Listing Writer', 'Etsy Administration Specialist', 'Facebook Ads Manager Freelancer', 'Google Data Studio Specialist',
    'Google AdWords Expert', 'Google Analytics Expert', 'HubSpot Specialist', 'High-Ticket Closing Freelancer',
    'Instagram Freelancer', 'Lead lists Freelancer', 'Link Builder', 'LinkedIn Specialist', 'Lead Generation Specialist',
    'Marketing Presentation Freelancer', 'Management Consultant', 'Marketing Freelancer', 'Oberlo Freelancer',
    'On-Page Optimization Expert', 'Outbound Sales Specialist', 'PPC Advertising Specialist', 'Programmatic Campaigns Freelancer',
    'Real Estate Freelancer', 'Real Estate Acquisition Freelancer', 'Salesforce Expert', 'Startup Consultant',
    'SEO Backlinking Specialist', 'SEO Expert', 'SEO Keyword Researcher', 'Social Media Marketer', 'Social Media Manager',
  ],
  'Writing & Translation': [
    'Arabic Translators & Writer', 'APA Formatting Freelancer', 'Academic Editing Freelancer', 'Article Writer',
    'Academic Proofreading Freelancer', 'AP Style Writer', 'Bahasa Indonesia Freelancer', 'Bulgarian Translators & Writer',
    'Blog Writer', 'Content Strategist', 'Content Writer', 'Copywriter', 'Company Profile Freelancer', 'Creative Writer',
    'Copy Editor', 'ePub Specialist', 'English - India Freelancer', 'English to Italian Translator', 'Estonian Freelancer',
    'English to Portuguese Translator', 'English to Korean Translator', 'English to Spanish Translator', 'Ebook Writer',
    'English Proofreader', 'English to Malay Translator', 'English to Polish Translator', 'Editor',
    'English to German Translator', 'English to Arabic Translator', 'Essay Writer', 'French Specialist', 'Financial Writer',
    'Filipino Translators & Writer', 'German - Germany Freelancer', 'Grammar Freelancer', 'Ghostwriter', 'German Specialist',
    'Grant Writer', 'Instructional Designer', 'Italian Specialist', 'Job Description Writer', 'Japanese Translators & Writer',
    'Japanese to English Translator', 'Kindle Direct Publishing Freelancer', 'Korean to English Translator',
    'Korean Translators & Writer', 'Line Editing Freelancer', 'Latvian Translators & Writer', 'Lyrics Writer',
    'LaTeX Editor', 'Literature Reviewer', 'Mathematics Teachers & Tutor', 'Malaysian Freelancer', 'Non-Fiction Writer',
    'Online Writer', 'Pitch Deck Writer', 'Product Description Writer', 'Proofreader', 'Poet', 'Proposal Writer',
    'Resume Design Freelancer', 'Romance Freelancer', 'Recipe Writer', 'Research Paper Writer', 'Resume Writer',
    'Romanian Translators & Writer', 'Research Specialist', 'Resume Freelancer', 'Scriptwriting Freelancer',
    'Spanish - Mexico Freelancer', 'Short story Freelancer', 'Screenplay Freelancer', 'Spanish Translators & Writer',
    'Script Freelancer', 'Sales Writing Specialist', 'Scientific Writer', 'SEO Writer', 'Sports Writer',
    'Tutoring Freelancer', 'Technical Writer', 'Thai Translators & Writer', 'Translator', 'Ukrainian Translators & Writer',
    'Website Content Manager', 'Web Content Freelancer', 'Website Copywriting Freelancer', 'Writer',
  ],
};

(async () => {
  let createdParents = 0, createdSubs = 0, skipped = 0;

  for (const p of PARENTS) {
    const [parent, created] = await Category.findOrCreate({
      where: { name: p.name },
      defaults: { name: p.name, icon: p.icon, parent_id: null },
    });
    if (created) createdParents++;

    const subs = SUBCATEGORIES[p.name] || [];
    for (const name of subs) {
      const [, subCreated] = await Category.findOrCreate({
        where: { name },
        defaults: { name, parent_id: parent.id },
      });
      if (subCreated) createdSubs++; else skipped++;
    }
  }

  console.log(`Done. Parents created: ${createdParents}/${PARENTS.length}. Subcategories created: ${createdSubs}. Skipped (already existed): ${skipped}.`);
  process.exit(0);
})().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
