class SchemaProcessor {
    constructor() {
        this.schemas = new Map();
        this.mainSchema = null;
        this.keywordUsage = new Map();
    }

    async processFiles(files) {
        this.schemas.clear();
        this.mainSchema = null;
        this.keywordUsage.clear();

        // Load all schemas
        for (const file of files) {
            const text = await file.text();
            const schema = JSON.parse(text);

            if (schema.$id) {
                this.schemas.set(schema.$id, schema);
            } else {
                // Schema without $id - treat as potential main schema
                this.schemas.set(file.name, schema);
            }

            // Identify main schema (has type: array)
            if (schema.type === 'array' && schema.items) {
                this.mainSchema = schema;
            }
        }

        // If no main schema found, try to use single schema
        if (!this.mainSchema && this.schemas.size === 1) {
            this.mainSchema = this.schemas.values().next().value;
        }

        // Collect keyword usage after processing all schemas
        if (this.mainSchema) {
            this.collectKeywordUsage();
        }

        return this.mainSchema !== null;
    }

    resolveRef(ref, baseSchema) {
        if (ref.startsWith('#')) {
            // Internal reference
            const path = ref.substring(2).split('/');
            let current = baseSchema;
            for (const segment of path) {
                current = current[segment];
                if (!current) return null;
            }
            return current;
        } else {
            // External reference
            for (const [id, schema] of this.schemas) {
                if (id.endsWith(ref) || ref.endsWith(id)) {
                    return schema;
                }
            }
            // Try simple filename match
            return this.schemas.get(ref) || null;
        }
    }

    extractProperties(schema, category = null) {
        const result = [];

        if (schema.properties) {
            for (const [name, propSchema] of Object.entries(schema.properties)) {
                result.push({
                    category: category,
                    name: name,
                    schema: propSchema,
                    required: schema.required?.includes(name) || false
                });
            }
        }

        if (schema.allOf) {
            for (const subSchema of schema.allOf) {
                if (subSchema.$ref) {
                    const resolved = this.resolveRef(subSchema.$ref, schema);
                    if (resolved) {
                        const subCategory = resolved.title || category;
                        result.push(...this.extractProperties(resolved, subCategory));
                    }
                } else {
                    result.push(...this.extractProperties(subSchema, category));
                }
            }
        }

        return result;
    }

    collectKeywordUsage() {
        const properties = this.getTableData()?.properties || [];

        // Keywords that should not be shown as columns
        const excludedKeywords = ['$schema', '$id', '$ref', 'properties', 'items', 'allOf', 'anyOf', 'oneOf', 'enumDescriptions'];

        for (const prop of properties) {
            const schema = prop.schema;

            // Collect all keywords from the schema
            for (const keyword of Object.keys(schema)) {
                if (!excludedKeywords.includes(keyword)) {
                    const count = this.keywordUsage.get(keyword) || 0;
                    this.keywordUsage.set(keyword, count + 1);
                }
            }
        }
    }

    getKeywordUsageStats() {
        // Sort by usage count (descending)
        return Array.from(this.keywordUsage.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([keyword, count]) => ({ keyword, count }));
    }

    getTableData() {
        if (!this.mainSchema) return null;

        let itemSchema = this.mainSchema.items;
        if (itemSchema?.$ref) {
            itemSchema = this.resolveRef(itemSchema.$ref, this.mainSchema);
        }

        if (!itemSchema) return null;

        const properties = this.extractProperties(itemSchema);

        return {
            title: this.mainSchema.title || 'Dataset Schema',
            description: this.mainSchema.description || '',
            properties: properties
        };
    }
}

class ColumnManager {
    constructor() {
        // Default columns that are always shown initially
        this.defaultColumns = [
            { keyword: 'name', display: 'Variable Name', width: 150 },
            { keyword: 'description', display: 'Description', width: 300 },
            { keyword: 'type', display: 'Data Type', width: 110 },
            { keyword: 'enum', display: 'Valid Values', width: 140 },
            { keyword: 'required', display: 'Required', width: 80 }
        ];

        // Default column order
        this.defaultColumnOrder = this.defaultColumns.map(c => c.keyword);

        // All possible column definitions
        this.columnDefinitions = {
            name: { display: 'Variable Name', width: 150 },
            description: { display: 'Description', width: 300 },
            type: { display: 'Data Type', width: 110 },
            format: { display: 'Format', width: 100 },
            enum: { display: 'Valid Values', width: 140 },
            required: { display: 'Required', width: 80 },
            default: { display: 'Default', width: 100 },
            const: { display: 'Constant', width: 100 },
            minimum: { display: 'Min', width: 80 },
            maximum: { display: 'Max', width: 80 },
            exclusiveMinimum: { display: 'Exclusive Min', width: 100 },
            exclusiveMaximum: { display: 'Exclusive Max', width: 100 },
            minLength: { display: 'Min Length', width: 90 },
            maxLength: { display: 'Max Length', width: 90 },
            pattern: { display: 'Pattern', width: 150 },
            multipleOf: { display: 'Multiple Of', width: 90 },
            minItems: { display: 'Min Items', width: 90 },
            maxItems: { display: 'Max Items', width: 90 },
            uniqueItems: { display: 'Unique Items', width: 100 },
            minProperties: { display: 'Min Properties', width: 110 },
            maxProperties: { display: 'Max Properties', width: 110 },
            deprecated: { display: 'Deprecated', width: 90 },
            readOnly: { display: 'Read Only', width: 90 },
            writeOnly: { display: 'Write Only', width: 90 },
            title: { display: 'Title', width: 150 },
            examples: { display: 'Examples', width: 200 },
            additionalInfo: { display: 'Additional Info', width: 200 }
        };

        // Currently selected columns
        this.selectedColumns = this.defaultColumns.map(c => c.keyword);

        // Track the current drag operation
        this.draggedIndex = null;
    }

    getSelectedColumns() {
        return this.selectedColumns;
    }

    setSelectedColumns(columns) {
        this.selectedColumns = columns;
    }

    moveColumn(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;

        const columns = [...this.selectedColumns];
        const [movedColumn] = columns.splice(fromIndex, 1);
        columns.splice(toIndex, 0, movedColumn);

        this.selectedColumns = columns;
        return columns;
    }

    resetColumnOrder() {
        // Reset to default order, keeping only currently selected columns
        const selected = new Set(this.selectedColumns);
        this.selectedColumns = this.defaultColumnOrder.filter(col => selected.has(col));

        // Add any selected columns not in default order at the end
        for (const col of selected) {
            if (!this.defaultColumnOrder.includes(col)) {
                this.selectedColumns.push(col);
            }
        }

        return this.selectedColumns;
    }

    getColumnDefinition(keyword) {
        return this.columnDefinitions[keyword] ||
               { display: this.formatKeywordDisplay(keyword), width: 120 };
    }

    formatKeywordDisplay(keyword) {
        // Convert camelCase to Title Case
        return keyword.replace(/([A-Z])/g, ' $1')
                     .replace(/^./, str => str.toUpperCase())
                     .trim();
    }

    renderColumnSelector(keywordStats) {
        const container = document.createElement('div');
        container.className = 'column-selector-container';
        container.innerHTML = `
            <div class="column-selector-header">Customize Table Columns</div>
            <div class="column-selector-dropdown">
                <div class="column-selector-button" id="columnSelectorBtn">
                    <span>${this.selectedColumns.length} columns selected</span>
                    <span>▼</span>
                </div>
                <div class="column-selector-list" id="columnSelectorList">
                    <div class="column-selector-controls">
                        <button class="column-selector-control-btn" id="selectAllBtn">Select All</button>
                        <button class="column-selector-control-btn" id="selectNoneBtn">Select None</button>
                        <button class="column-selector-control-btn" id="selectDefaultBtn">Default</button>
                        <button class="column-selector-control-btn reset-order-btn" id="resetOrderBtn">Reset Order</button>
                    </div>
                    <div class="column-list-container" id="columnCheckboxList"></div>
                </div>
            </div>
        `;

        // Store keyword stats for later use
        this.keywordStats = keywordStats;

        // Populate checkbox list
        this.refreshColumnList(container);

        // Add event listeners
        this.attachSelectorEvents(container);

        return container;
    }

    refreshColumnList(container) {
        const checkboxList = container.querySelector('#columnCheckboxList');
        checkboxList.innerHTML = '';

        // Create a map of keyword to count
        const keywordCountMap = new Map();
        if (this.keywordStats) {
            for (const { keyword, count } of this.keywordStats) {
                keywordCountMap.set(keyword, count);
            }
        }

        // Render selected columns in their current order
        const addedKeywords = new Set();
        for (let i = 0; i < this.selectedColumns.length; i++) {
            const keyword = this.selectedColumns[i];
            const def = this.getColumnDefinition(keyword);
            const count = keyword === 'additionalInfo' ? null : keywordCountMap.get(keyword) || null;
            this.renderCheckboxItem(checkboxList, keyword, def.display, count, addedKeywords, i, true);
        }

        // Collect unselected keywords and sort by count
        const unselectedKeywords = [];
        const allKeywords = ['name', 'required', 'additionalInfo', ...Object.keys(this.columnDefinitions)];

        for (const keyword of allKeywords) {
            if (!addedKeywords.has(keyword)) {
                const count = keyword === 'additionalInfo' ? null : keywordCountMap.get(keyword) || 0;
                unselectedKeywords.push({ keyword, count });
            }
        }

        // Sort unselected keywords by count (descending), with null values at the end
        unselectedKeywords.sort((a, b) => {
            if (a.count === null) return 1;
            if (b.count === null) return -1;
            return b.count - a.count;
        });

        // Add section separator if there are unselected items
        if (unselectedKeywords.length > 0 && this.selectedColumns.length > 0) {
            const separator = document.createElement('div');
            separator.style.borderTop = '2px solid #e9ecef';
            separator.style.margin = '10px 0';
            separator.style.padding = '10px 15px 5px';
            separator.style.fontSize = '12px';
            separator.style.color = '#718096';
            separator.style.fontWeight = '600';
            separator.textContent = 'Available Columns (sorted by usage):';
            checkboxList.appendChild(separator);
        }

        // Render unselected keywords
        for (const { keyword, count } of unselectedKeywords) {
            const def = this.getColumnDefinition(keyword);
            this.renderCheckboxItem(checkboxList, keyword, def.display, count, addedKeywords, -1, false);
        }
    }

    renderCheckboxItem(container, keyword, display, count, addedKeywords, index, isSelected) {
        if (addedKeywords.has(keyword)) return;
        addedKeywords.add(keyword);

        const item = document.createElement('div');
        const isMandatory = keyword === 'name';
        item.className = 'column-selector-item' + (isMandatory ? ' mandatory' : '');
        item.draggable = isSelected && !isMandatory; // Only selected non-mandatory items are draggable
        item.dataset.keyword = keyword;
        item.dataset.index = index >= 0 ? index : '';

        const countDisplay = count !== null ? `<span class="keyword-count">${count} properties</span>` : '';
        const dragHandle = (isSelected && !isMandatory) ? '<span class="drag-handle">⋮⋮</span>' :
                           (isSelected && isMandatory) ? '<span class="drag-handle" style="visibility: hidden;">⋮⋮</span>' : '';

        item.innerHTML = `
            ${dragHandle}
            <input type="checkbox"
                   class="column-selector-checkbox"
                   id="col-${keyword}"
                   value="${keyword}"
                   ${isSelected ? 'checked' : ''}
                   ${isMandatory ? 'disabled' : ''}>
            <label for="col-${keyword}" class="column-selector-label">
                <span class="keyword-name">${display}</span>
                ${countDisplay}
            </label>
        `;

        // Add drag event listeners if selected and not mandatory
        if (isSelected && !isMandatory) {
            this.addDragEventListeners(item);
        }

        container.appendChild(item);
    }

    addDragEventListeners(item) {
        item.addEventListener('dragstart', (e) => {
            this.draggedIndex = parseInt(item.dataset.index);
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', item.innerHTML);
        });

        item.addEventListener('dragend', (e) => {
            item.classList.remove('dragging');
            // Remove all drag-over classes
            document.querySelectorAll('.column-selector-item').forEach(el => {
                el.classList.remove('drag-over');
            });
        });

        item.addEventListener('dragover', (e) => {
            if (e.preventDefault) {
                e.preventDefault();
            }
            e.dataTransfer.dropEffect = 'move';

            const draggedItem = document.querySelector('.dragging');
            if (draggedItem && draggedItem !== item && item.draggable) {
                item.classList.add('drag-over');
            }

            return false;
        });

        item.addEventListener('dragleave', (e) => {
            item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
            if (e.stopPropagation) {
                e.stopPropagation();
            }

            const targetIndex = parseInt(item.dataset.index);
            if (this.draggedIndex !== null && targetIndex >= 0 && this.draggedIndex !== targetIndex) {
                this.moveColumn(this.draggedIndex, targetIndex);

                // Refresh the list to reflect new order
                const container = item.closest('.column-selector-container');
                this.refreshColumnList(container);

                // Update table
                if (window.currentData) {
                    const tableOutput = document.getElementById('tableOutput');
                    tableOutput.innerHTML = window.renderer.render(window.currentData, this.selectedColumns);
                }
            }

            item.classList.remove('drag-over');
            this.draggedIndex = null;

            return false;
        });
    }

    attachSelectorEvents(container) {
        const button = container.querySelector('#columnSelectorBtn');
        const list = container.querySelector('#columnSelectorList');
        const selectAllBtn = container.querySelector('#selectAllBtn');
        const selectNoneBtn = container.querySelector('#selectNoneBtn');
        const selectDefaultBtn = container.querySelector('#selectDefaultBtn');
        const resetOrderBtn = container.querySelector('#resetOrderBtn');

        // Toggle dropdown
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            list.classList.toggle('show');
            button.classList.toggle('open');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                list.classList.remove('show');
                button.classList.remove('open');
            }
        });

        // Select all
        selectAllBtn.addEventListener('click', () => {
            const allKeywords = new Set([...this.selectedColumns]);
            container.querySelectorAll('.column-selector-checkbox').forEach(cb => {
                if (!cb.checked) {
                    allKeywords.add(cb.value);
                }
                cb.checked = true;
            });
            this.selectedColumns = Array.from(allKeywords);
            this.refreshColumnList(container);
            this.updateTable(container);
        });

        // Select none
        selectNoneBtn.addEventListener('click', () => {
            // Always keep name column only
            this.selectedColumns = ['name'];
            this.refreshColumnList(container);
            this.updateTable(container);
        });

        // Select default
        selectDefaultBtn.addEventListener('click', () => {
            this.selectedColumns = this.defaultColumns.map(c => c.keyword);
            this.refreshColumnList(container);
            this.updateTable(container);
        });

        // Reset Order
        resetOrderBtn.addEventListener('click', () => {
            this.resetColumnOrder();
            this.refreshColumnList(container);
            this.updateTable(container);
        });

        // Handle individual checkbox changes using event delegation
        container.addEventListener('change', (e) => {
            if (e.target.classList.contains('column-selector-checkbox')) {
                this.handleCheckboxChange(e.target, container);
            }
        });
    }

    handleCheckboxChange(checkbox, container) {
        const keyword = checkbox.value;

        if (checkbox.checked) {
            // Add to selected columns if not already present
            if (!this.selectedColumns.includes(keyword)) {
                this.selectedColumns.push(keyword);
            }
        } else {
            // Remove from selected columns, but keep 'name' always
            if (keyword !== 'name') {
                this.selectedColumns = this.selectedColumns.filter(col => col !== keyword);
            } else {
                // Don't allow unchecking 'name' column
                checkbox.checked = true;
                return;
            }
        }

        this.refreshColumnList(container);
        this.updateTable(container);
    }

    updateTable(container) {
        // Update button text
        const button = container.querySelector('#columnSelectorBtn span:first-child');
        button.textContent = `${this.selectedColumns.length} columns selected`;

        // Update table
        if (window.currentData) {
            const tableOutput = document.getElementById('tableOutput');
            tableOutput.innerHTML = window.renderer.render(window.currentData, this.selectedColumns);
        }
    }

}

class TableRenderer {
    constructor(columnManager) {
        this.columnManager = columnManager;
    }

    formatType(schema) {
        if (Array.isArray(schema.type)) {
            return schema.type.join(' | ');
        }
        let type = schema.type || 'any';
        if (schema.format) {
            return `${type} (${schema.format})`;
        }
        return type;
    }

    formatValue(value, isJson = false) {
        if (value === null || value === undefined) {
            return '';
        }

        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }

        if (typeof value === 'object') {
            const json = JSON.stringify(value, null, 2);
            if (json.length > 100) {
                return `<span class="cell-value-json" title="${this.escapeHtml(json)}">${this.escapeHtml(json.substring(0, 100))}...</span>`;
            }
            return `<span class="cell-value-json">${this.escapeHtml(json)}</span>`;
        }

        if (isJson) {
            return `<span class="cell-value-json">${this.escapeHtml(String(value))}</span>`;
        }

        return this.escapeHtml(String(value));
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatConstraints(schema) {
        const constraints = [];

        if (schema.minimum !== undefined || schema.maximum !== undefined) {
            const min = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? `>${schema.exclusiveMinimum}` : '');
            const max = schema.maximum ?? (schema.exclusiveMaximum !== undefined ? `<${schema.exclusiveMaximum}` : '');
            if (min || max) {
                constraints.push(`Range: ${min}${(min !== '' && max !== '') ? '-' : ''}${max}`);
            }
        }

        if (schema.minLength || schema.maxLength) {
            const len = schema.minLength === schema.maxLength ?
                `${schema.minLength} chars` :
                `${schema.minLength || '0'}-${schema.maxLength || '∞'} chars`;
            constraints.push(len);
        }

        if (schema.pattern) {
            constraints.push(`Pattern: ${schema.pattern}`);
        }

        if (schema.multipleOf) {
            constraints.push(`Multiple of ${schema.multipleOf}`);
        }

        return constraints;
    }

    formatEnum(schema) {
        if (!schema.enum) return '';

        const hasDescriptions = schema.enumDescriptions &&
            Array.isArray(schema.enumDescriptions) &&
            schema.enumDescriptions.length === schema.enum.length;

        const enumId = 'enum_' + Math.random().toString(36).substr(2, 9);

        let html = `<div class="enum-container">
            <span class="enum-toggle" onclick="toggleEnum('${enumId}')">
                ${schema.enum.length} values ▼
            </span>
            <div id="${enumId}" class="enum-list">`;

        schema.enum.forEach((value, index) => {
            const desc = hasDescriptions ? schema.enumDescriptions[index] : '';
            html += `<div class="enum-item">
                <div class="enum-value">${this.escapeHtml(String(value))}</div>
                ${desc ? `<div class="enum-desc">${this.escapeHtml(desc)}</div>` : ''}
            </div>`;
        });

        html += `</div></div>`;
        return html;
    }

    formatCellValue(keyword, prop, schema) {
        switch (keyword) {
            case 'name':
                return `<span class="variable-name">${prop.name}</span>`;

            case 'description':
                return schema.description || '';

            case 'type':
                return `<span class="data-type">${this.formatType(schema)}</span>`;

            case 'enum':
                if (schema.const !== undefined) {
                    return `<span class="const-value">${this.escapeHtml(String(schema.const))}</span>`;
                }
                return this.formatEnum(schema);

            case 'required':
                return prop.required ?
                    '<span class="required-badge">Yes</span>' :
                    '<span class="optional-badge">No</span>';

            case 'default':
                return schema.default !== undefined ?
                    this.formatValue(schema.default, true) : '';

            case 'const':
                return schema.const !== undefined ?
                    `<span class="const-value">${this.escapeHtml(String(schema.const))}</span>` : '';

            case 'minimum':
            case 'maximum':
            case 'exclusiveMinimum':
            case 'exclusiveMaximum':
            case 'minLength':
            case 'maxLength':
            case 'multipleOf':
            case 'minItems':
            case 'maxItems':
            case 'minProperties':
            case 'maxProperties':
                return schema[keyword] !== undefined ?
                    `<span class="constraint">${schema[keyword]}</span>` : '';

            case 'pattern':
                return schema.pattern ?
                    `<span class="constraint" title="${this.escapeHtml(schema.pattern)}">${this.escapeHtml(schema.pattern.substring(0, 20))}${schema.pattern.length > 20 ? '...' : ''}</span>` : '';

            case 'format':
                return schema.format ?
                    `<span class="data-type">${schema.format}</span>` : '';

            case 'deprecated':
            case 'readOnly':
            case 'writeOnly':
            case 'uniqueItems':
                return schema[keyword] === true ?
                    '<span class="required-badge">Yes</span>' : '';

            case 'title':
                return schema.title || '';

            case 'examples':
                if (schema.examples && Array.isArray(schema.examples)) {
                    return this.formatValue(schema.examples, true);
                }
                return '';

            case 'additionalInfo':
                return this.formatAdditionalInfo(prop, schema);

            default:
                // For any other keyword, display its value if it exists
                if (schema[keyword] !== undefined) {
                    return this.formatValue(schema[keyword]);
                }
                return '';
        }
    }

    formatAdditionalInfo(prop, schema) {
        // Keywords that are handled in other columns and should be excluded
        const excludedKeywords = [
            'name', 'description', 'type', 'enum', 'enumDescriptions', 'const',
            'required', '$schema', '$id', '$ref', 'properties', 'items',
            'allOf', 'anyOf', 'oneOf'
        ];

        // Get currently displayed columns
        const displayedColumns = this.columnManager.getSelectedColumns();

        // Collect all other keywords not in displayed columns
        const additionalData = {};
        for (const [key, value] of Object.entries(schema)) {
            if (!excludedKeywords.includes(key) &&
                !displayedColumns.includes(key) &&
                value !== undefined && value !== null) {
                additionalData[key] = value;
            }
        }

        if (Object.keys(additionalData).length === 0) {
            return '';
        }

        // Create a collapsible section for additional info
        const addId = 'add_' + Math.random().toString(36).substr(2, 9);
        const items = Object.entries(additionalData).map(([k, v]) => {
            let displayValue;
            if (typeof v === 'object') {
                displayValue = JSON.stringify(v, null, 2);
            } else {
                displayValue = String(v);
            }
            return `<div class="property"><strong>${this.columnManager.formatKeywordDisplay(k)}:</strong> ${this.escapeHtml(displayValue)}</div>`;
        }).join('');

        return `<span class="additional-info" onclick="toggleAdditional('${addId}')">
            ${Object.keys(additionalData).length} properties...
        </span>
        <div id="${addId}" class="additional-content">
            ${items}
        </div>`;
    }

    formatConstraintsForCSV(schema) {
        const constraints = this.formatConstraints(schema);
        return constraints.join('\n');
    }

    formatAdditionalInfoForCSV(prop, schema) {
        // Keywords that are handled in other columns and should be excluded
        const excludedKeywords = [
            'name', 'description', 'type', 'enum', 'enumDescriptions', 'const',
            'required', '$schema', '$id', '$ref', 'properties', 'items',
            'allOf', 'anyOf', 'oneOf'
        ];

        // Get currently displayed columns
        const displayedColumns = this.columnManager.getSelectedColumns();

        // Collect all other keywords not in displayed columns
        const additionalData = [];
        for (const [key, value] of Object.entries(schema)) {
            if (!excludedKeywords.includes(key) &&
                !displayedColumns.includes(key) &&
                value !== undefined && value !== null) {
                const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                additionalData.push(`${this.columnManager.formatKeywordDisplay(key)}: ${displayValue}`);
            }
        }

        return additionalData.join('\n');
    }

    formatEnumForCSV(schema) {
        if (!schema.enum) return '';

        const hasDescriptions = schema.enumDescriptions &&
            Array.isArray(schema.enumDescriptions) &&
            schema.enumDescriptions.length === schema.enum.length;

        if (hasDescriptions) {
            return schema.enum.map((value, index) =>
                `${value}: ${schema.enumDescriptions[index]}`
            ).join('\n');
        } else {
            return schema.enum.join('\n');
        }
    }

    render(data, selectedColumns = null) {
        if (!data) return '<div class="error-message">No valid schema data to display</div>';

        const columns = selectedColumns || this.columnManager.getSelectedColumns();
        const hasCategories = data.properties.some(p => p.category);

        let html = `<div class="table-container">
            <div class="table-header">
                <div class="table-title">${data.title}</div>
                ${data.description ? `<div class="subtitle">${data.description}</div>` : ''}
            </div>
            <div class="search-box">
                <input type="text" class="search-input" id="searchInput"
                       placeholder="Search variables..." onkeyup="filterTable()">
            </div>
            <div class="table-scroll-wrapper">
                <table id="dataTable">
                    <thead>
                        <tr>`;

        // Add table headers for selected columns
        for (const col of columns) {
            const def = this.columnManager.getColumnDefinition(col);
            html += `<th class="col-${col}">${def.display}</th>`;
        }

        html += `</tr>
                    </thead>
                    <tbody>`;

        let lastCategory = null;
        for (const prop of data.properties) {
            // Add category row if changed
            if (hasCategories && prop.category && prop.category !== lastCategory) {
                html += `<tr class="category-row">
                    <td colspan="${columns.length}">${prop.category}</td>
                </tr>`;
                lastCategory = prop.category;
            }

            html += `<tr class="data-row">`;

            // Add cells for selected columns
            for (const col of columns) {
                const cellValue = this.formatCellValue(col, prop, prop.schema);
                html += `<td class="cell-${col}">${cellValue}</td>`;
            }

            html += `</tr>`;
        }

        html += `</tbody></table></div></div>`;
        return html;
    }

    exportToCSV(data, selectedColumns = null) {
        if (!data) return '';

        const columns = selectedColumns || this.columnManager.getSelectedColumns();
        const headers = ['Category'];

        // Add headers for selected columns
        for (const col of columns) {
            const def = this.columnManager.getColumnDefinition(col);
            headers.push(def.display);
        }

        const rows = [headers];

        let currentCategory = '';
        for (const prop of data.properties) {
            if (prop.category && prop.category !== currentCategory) {
                currentCategory = prop.category;
            }

            const row = [currentCategory || ''];

            // Add values for selected columns
            for (const col of columns) {
                let value = '';

                switch (col) {
                    case 'name':
                        value = prop.name;
                        break;
                    case 'description':
                        value = prop.schema.description || '';
                        break;
                    case 'type':
                        value = this.formatType(prop.schema);
                        break;
                    case 'enum':
                        value = prop.schema.const !== undefined ?
                            String(prop.schema.const) :
                            this.formatEnumForCSV(prop.schema);
                        break;
                    case 'required':
                        value = prop.required ? 'Yes' : 'No';
                        break;
                    case 'additionalInfo':
                        value = this.formatAdditionalInfoForCSV(prop, prop.schema);
                        break;
                    default:
                        if (prop.schema[col] !== undefined) {
                            value = JSON.stringify(prop.schema[col]);
                        }
                }

                row.push(value);
            }

            rows.push(row);
        }

        // Format for Excel with proper escaping
        return rows.map(row =>
            row.map(cell => {
                const cellStr = String(cell).replace(/"/g, '""');
                // Always quote cells that contain newlines, commas, or quotes
                if (cellStr.includes('\n') || cellStr.includes(',') || cellStr.includes('"')) {
                    return `"${cellStr}"`;
                }
                return cellStr;
            }).join(',')
        ).join('\n');
    }
}

// Global functions for event handlers
window.toggleEnum = function(id) {
    const element = document.getElementById(id);
    element.classList.toggle('show');
};

window.toggleAdditional = function(id) {
    const element = document.getElementById(id);
    element.classList.toggle('show');
};

window.filterTable = function() {
    const input = document.getElementById('searchInput');
    const filter = input.value.toLowerCase();
    const rows = document.querySelectorAll('#dataTable tbody .data-row');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(filter)) {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    });
};

// Initialize
const processor = new SchemaProcessor();
const columnManager = new ColumnManager();
const renderer = new TableRenderer(columnManager);
let currentData = null;

// Make renderer and currentData globally accessible for column updates
window.renderer = renderer;
window.currentData = currentData;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('fileInput').addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        const fileInfo = document.getElementById('fileInfo');
        const processBtn = document.getElementById('processBtn');
        const errorMessage = document.getElementById('errorMessage');

        if (files.length === 0) {
            fileInfo.textContent = 'No files selected';
            processBtn.style.display = 'none';
            return;
        }

        fileInfo.textContent = files.length === 1 ?
            files[0].name :
            `${files.length} files selected`;

        processBtn.style.display = 'inline-block';
        errorMessage.innerHTML = '';
    });

    document.getElementById('processBtn').addEventListener('click', async () => {
        const files = Array.from(document.getElementById('fileInput').files);
        const errorMessage = document.getElementById('errorMessage');
        const tableOutput = document.getElementById('tableOutput');
        const exportBtn = document.getElementById('exportBtn');
        const columnSelectorContainer = document.getElementById('columnSelectorContainer');

        try {
            tableOutput.innerHTML = '<div class="loading">Processing schemas...</div>';

            const success = await processor.processFiles(files);

            if (!success) {
                throw new Error('Could not identify main schema. Please ensure one schema has type: "array" with items.');
            }

            currentData = processor.getTableData();
            window.currentData = currentData;

            // Get keyword usage statistics
            const keywordStats = processor.getKeywordUsageStats();

            // Render column selector
            columnSelectorContainer.innerHTML = '';
            columnSelectorContainer.appendChild(columnManager.renderColumnSelector(keywordStats));
            columnSelectorContainer.style.display = 'block';

            // Render table with default columns
            tableOutput.innerHTML = renderer.render(currentData);
            exportBtn.style.display = 'inline-block';

        } catch (error) {
            errorMessage.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
            tableOutput.innerHTML = '';
            exportBtn.style.display = 'none';
            columnSelectorContainer.style.display = 'none';
        }
    });

    document.getElementById('exportBtn').addEventListener('click', () => {
        if (!currentData) return;

        const csv = renderer.exportToCSV(currentData, columnManager.getSelectedColumns());
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'data_dictionary.csv';
        a.click();
        URL.revokeObjectURL(url);
    });

    // Close enum dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.classList.contains('enum-toggle')) {
            document.querySelectorAll('.enum-list.show').forEach(el => {
                el.classList.remove('show');
            });
        }
    });
});