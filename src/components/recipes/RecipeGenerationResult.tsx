// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, SafeAreaView } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

type Props = {
  visible: boolean;
  recipeData: any;       // full AI response: { recipe, ingredients, iceIngredient, pricing, batchRecipe, ... }
  selectedVariant?: any | null;
  onSave: (edited: any) => void;
  onDiscard: () => void;
};

const toNum = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function RecipeGenerationResult({ visible, recipeData, selectedVariant, onSave, onDiscard }: Props) {
  const { theme } = useTheme();
  const c = theme.colours;

  const recipe = recipeData?.recipe || {};
  const initialIngredients = Array.isArray(recipeData?.ingredients) ? recipeData.ingredients : [];
  const iceIngredient = recipeData?.iceIngredient || null;
  const pricing = recipeData?.pricing || {};
  const batchRecipe = recipeData?.batchRecipe || null;

  const [name, setName] = useState(selectedVariant?.name || recipe.name || '');
  const [method, setMethod] = useState(recipe.method || '');
  const [glassware, setGlassware] = useState(recipe.glassware || '');
  const [garnish, setGarnish] = useState(recipe.garnish || '');

  const [ingredients, setIngredients] = useState(() => initialIngredients.map((ing: any, idx: number) => ({
    key: `ing_${idx}`,
    name: ing?.name ?? 'Ingredient',
    qty: ing?.qty ?? 0,
    unit: ing?.unit ?? 'ml',
    matchedProductName: ing?.matchedProductName ?? ing?.matchedProductId ?? null,
    costPerServe: Number.isFinite(ing?.costPerServe) ? Number(ing.costPerServe) : 0,
    isInHouse: !!ing?.isInHouse,
    supplierSuggestion: ing?.supplierSuggestion ?? null,
    addToProducts: false,
    editingProduct: false,
    editingCost: false,
  })));

  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const [sellPrice, setSellPrice] = useState(
    Number.isFinite(pricing.suggestedSellingPrice) ? String(pricing.suggestedSellingPrice) : ''
  );

  const [batchOpen, setBatchOpen] = useState(false);

  const totalCost = useMemo(
    () => ingredients.reduce((sum, ing) => sum + toNum(ing.costPerServe), 0),
    [ingredients]
  );

  const gpPct = useMemo(() => {
    const price = toNum(sellPrice);
    if (price <= 0) return 0;
    return Math.max(0, Math.min(100, ((price - totalCost) / price) * 100));
  }, [sellPrice, totalCost]);

  const updateIngredient = (key: string, patch: any) => {
    setIngredients((prev) => prev.map((ing) => (ing.key === key ? { ...ing, ...patch } : ing)));
  };

  const handleSave = () => {
    onSave({
      name: name.trim() || recipe.name || 'Untitled',
      method,
      glassware,
      garnish,
      description: recipe.description || '',
      bartenderNotes: recipe.bartenderNotes || '',
      ingredients: ingredients.map((ing) => ({
        name: ing.name,
        qty: ing.qty,
        unit: ing.unit,
        matchedProductName: ing.matchedProductName,
        costPerServe: toNum(ing.costPerServe),
        isInHouse: ing.isInHouse,
        addToProducts: ing.addToProducts,
      })),
      iceIngredient,
      pricing: {
        estimatedCostPerServe: totalCost,
        suggestedSellingPrice: toNum(sellPrice),
        estimatedGpPct: gpPct,
        priceGuide: pricing.priceGuide || null,
      },
      batchRecipe,
    });
  };

  const Chip = ({ label, value, onChangeText, placeholder }: any) => (
    <View style={{ flex: 1, marginRight: 8 }}>
      <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.slateMid, marginBottom: 4 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.slateMid}
        style={{
          borderWidth: 1, borderColor: c.border, borderRadius: 10,
          paddingHorizontal: 10, paddingVertical: 8,
          fontFamily: theme.fontBody, fontSize: 13, color: c.text, backgroundColor: c.surface,
        }}
      />
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDiscard}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.oat }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          {/* Banner */}
          <View
            style={{
              backgroundColor: c.positiveSoft,
              borderRadius: 10,
              paddingVertical: 8,
              paddingHorizontal: 12,
              marginBottom: 16,
            }}
          >
            <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 12, color: c.positiveStrong }}>
              ✦ AI generated — review and edit before saving
            </Text>
          </View>

          {/* Name */}
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Recipe name"
            placeholderTextColor={c.slateMid}
            style={{
              fontFamily: theme.fontTitle,
              fontSize: 24,
              color: c.text,
              borderBottomWidth: 1,
              borderBottomColor: c.border,
              paddingBottom: 8,
              marginBottom: 16,
            }}
          />

          {/* Method / Glassware / Garnish */}
          <View style={{ flexDirection: 'row', marginBottom: 18 }}>
            <Chip label="Glassware" value={glassware} onChangeText={setGlassware} placeholder="e.g., Coupe" />
            <Chip label="Garnish" value={garnish} onChangeText={setGarnish} placeholder="e.g., Lime twist" />
          </View>
          <View style={{ marginBottom: 18 }}>
            <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.slateMid, marginBottom: 4 }}>Method</Text>
            <TextInput
              value={method}
              onChangeText={setMethod}
              placeholder="Steps, prep notes…"
              placeholderTextColor={c.slateMid}
              multiline
              style={{
                borderWidth: 1, borderColor: c.border, borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 10, minHeight: 90, textAlignVertical: 'top',
                fontFamily: theme.fontBody, fontSize: 13, color: c.text, backgroundColor: c.surface,
              }}
            />
          </View>

          {/* Ingredients */}
          <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 14, color: c.text, marginBottom: 10 }}>
            Ingredients
          </Text>
          {ingredients.map((ing, idx) => {
            const isMatched = !!ing.matchedProductName && !ing.isInHouse;
            const isInHouse = ing.isInHouse;
            const isUnmatched = !isMatched && !isInHouse;
            const isEditing = editingIdx === idx;

            return (
              <View
                key={ing.key}
                style={{
                  backgroundColor: c.surface,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: c.border,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 14 }}>
                      {isMatched ? '🔗' : isInHouse ? '🏠' : '⚠️'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 14, color: c.text }}>
                        {ing.name}
                      </Text>
                      <Text style={{ fontFamily: theme.fontBody, fontSize: 12, color: c.textSecondary }}>
                        {ing.qty} {ing.unit}
                      </Text>
                    </View>
                  </View>
                  {isMatched && (
                    <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 12, color: c.success }}>
                      ✓ ${toNum(ing.costPerServe).toFixed(2)}/serve
                    </Text>
                  )}
                </View>

                {isMatched && (
                  <TouchableOpacity onPress={() => setEditingIdx(isEditing ? null : idx)} style={{ marginTop: 8 }}>
                    {isEditing ? (
                      <TextInput
                        autoFocus
                        value={ing.matchedProductName}
                        onChangeText={(v) => updateIngredient(ing.key, { matchedProductName: v })}
                        onBlur={() => setEditingIdx(null)}
                        placeholder="Product name"
                        placeholderTextColor={c.slateMid}
                        style={{
                          borderWidth: 1, borderColor: c.border, borderRadius: 8,
                          paddingHorizontal: 10, paddingVertical: 6,
                          fontFamily: theme.fontBody, fontSize: 12, color: c.text, backgroundColor: c.oat,
                        }}
                      />
                    ) : (
                      <Text style={{ fontFamily: theme.fontBody, fontSize: 12, color: c.deepBlue }}>
                        Linked to: {ing.matchedProductName} · tap to change
                      </Text>
                    )}
                  </TouchableOpacity>
                )}

                {isUnmatched && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ fontFamily: theme.fontBody, fontSize: 12, color: c.amber, marginBottom: 4 }}>
                      Not in your products
                    </Text>
                    {!!ing.supplierSuggestion && (
                      <Text style={{ fontFamily: theme.fontBody, fontSize: 12, color: c.textSecondary, marginBottom: 6 }}>
                        Suggested supplier: {ing.supplierSuggestion}
                      </Text>
                    )}
                    {ing.editingCost ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontFamily: theme.fontBody, fontSize: 12, color: c.textSecondary }}>$</Text>
                        <TextInput
                          autoFocus
                          value={String(ing.costPerServe ?? '')}
                          onChangeText={(v) => updateIngredient(ing.key, { costPerServe: v === '' ? 0 : Number(v) || 0 })}
                          onBlur={() => updateIngredient(ing.key, { editingCost: false })}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          placeholderTextColor={c.slateMid}
                          style={{
                            flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 8,
                            paddingHorizontal: 10, paddingVertical: 6,
                            fontFamily: theme.fontBody, fontSize: 12, color: c.text, backgroundColor: c.oat,
                          }}
                        />
                        <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.textSecondary }}>per serve</Text>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => updateIngredient(ing.key, { addToProducts: !ing.addToProducts })}
                          style={{
                            paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
                            backgroundColor: ing.addToProducts ? c.deepBlue : c.oat,
                            borderWidth: 1, borderColor: c.border,
                          }}
                        >
                          <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 11, color: ing.addToProducts ? c.primaryText : c.text }}>
                            {ing.addToProducts ? '✓ Will add to products' : '+ Add to products'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => updateIngredient(ing.key, { editingCost: true })}
                          style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: c.oat, borderWidth: 1, borderColor: c.border }}
                        >
                          <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 11, color: c.text }}>
                            Enter cost manually
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}

                {isInHouse && (
                  <View style={{ marginTop: 8 }}>
                    {ing.editingCost ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontFamily: theme.fontBody, fontSize: 12, color: c.textSecondary }}>$</Text>
                        <TextInput
                          autoFocus
                          value={String(ing.costPerServe ?? '')}
                          onChangeText={(v) => updateIngredient(ing.key, { costPerServe: v === '' ? 0 : Number(v) || 0 })}
                          onBlur={() => updateIngredient(ing.key, { editingCost: false })}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          placeholderTextColor={c.slateMid}
                          style={{
                            flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 8,
                            paddingHorizontal: 10, paddingVertical: 6,
                            fontFamily: theme.fontBody, fontSize: 12, color: c.text, backgroundColor: c.oat,
                          }}
                        />
                        <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.textSecondary }}>per shot</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => updateIngredient(ing.key, { editingCost: true })}
                        style={{ alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: c.oat, borderWidth: 1, borderColor: c.border }}
                      >
                        <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 11, color: c.text }}>
                          Set cost per shot {ing.costPerServe ? `($${toNum(ing.costPerServe).toFixed(2)})` : ''}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })}

          {/* Ice / Dilution */}
          {!!iceIngredient && (
            <View
              style={{
                backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border,
                padding: 12, marginTop: 8, marginBottom: 18,
              }}
            >
              <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 13, color: c.text, marginBottom: 6 }}>
                🧊 Ice & dilution
              </Text>
              <Text style={{ fontFamily: theme.fontBody, fontSize: 12, color: c.textSecondary, marginBottom: 4 }}>
                Dilution: {Number.isFinite(iceIngredient.dilutionPct) ? `${iceIngredient.dilutionPct}%` : '—'}
              </Text>
              {!!iceIngredient.volumeNote && (
                <Text style={{ fontFamily: theme.fontBody, fontSize: 12, color: c.textSecondary, marginBottom: 4 }}>
                  {iceIngredient.volumeNote}
                </Text>
              )}
              {!!iceIngredient.batchColdWaterNote && (
                <Text style={{ fontFamily: theme.fontBody, fontSize: 12, color: c.textSecondary }}>
                  {iceIngredient.batchColdWaterNote}
                </Text>
              )}
            </View>
          )}

          {/* Pricing */}
          <View style={{ marginTop: 8, marginBottom: 18 }}>
            <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 14, color: c.text, marginBottom: 10 }}>
              Pricing
            </Text>
            <View
              style={{
                backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 12,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ fontFamily: theme.fontBody, fontSize: 13, color: c.textSecondary }}>Estimated cost / serve</Text>
                <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 13, color: c.text }}>${totalCost.toFixed(2)}</Text>
              </View>

              <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.slateMid, marginBottom: 4 }}>Sell price</Text>
              <TextInput
                value={sellPrice}
                onChangeText={setSellPrice}
                placeholder="0.00"
                placeholderTextColor={c.slateMid}
                keyboardType="decimal-pad"
                style={{
                  borderWidth: 1, borderColor: c.border, borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10,
                  fontFamily: theme.fontBody, fontSize: 15, color: c.text, backgroundColor: c.oat,
                  marginBottom: 10,
                }}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ fontFamily: theme.fontBody, fontSize: 13, color: c.textSecondary }}>Gross profit</Text>
                <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 16, color: c.success }}>{gpPct.toFixed(1)}%</Text>
              </View>

              {!!pricing.priceGuide && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 }}>
                  <View>
                    <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.slateMid }}>Budget</Text>
                    <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 13, color: c.text }}>
                      {Number.isFinite(pricing.priceGuide.budget) ? `$${Number(pricing.priceGuide.budget).toFixed(2)}` : '—'}
                    </Text>
                  </View>
                  <View>
                    <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.slateMid }}>Mid</Text>
                    <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 13, color: c.text }}>
                      {Number.isFinite(pricing.priceGuide.mid) ? `$${Number(pricing.priceGuide.mid).toFixed(2)}` : '—'}
                    </Text>
                  </View>
                  <View>
                    <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.slateMid }}>Premium</Text>
                    <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 13, color: c.text }}>
                      {Number.isFinite(pricing.priceGuide.premium) ? `$${Number(pricing.priceGuide.premium).toFixed(2)}` : '—'}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Batch recipe */}
          {!!batchRecipe && (
            <View style={{ marginBottom: 18 }}>
              <TouchableOpacity
                onPress={() => setBatchOpen((o) => !o)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}
              >
                <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 14, color: c.text }}>
                  📦 Batch recipe (×{batchRecipe.serves || 10} serves)
                </Text>
                <Text style={{ fontFamily: theme.fontBody, fontSize: 13, color: c.deepBlue }}>
                  {batchOpen ? 'Hide' : 'Show'}
                </Text>
              </TouchableOpacity>

              {batchOpen && (
                <View style={{ backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 12, marginTop: 8 }}>
                  <View style={{ backgroundColor: c.positiveSoft, borderRadius: 8, padding: 8, marginBottom: 10 }}>
                    <Text style={{ fontFamily: theme.fontBody, fontSize: 11, color: c.positiveStrong }}>
                      Use this as a template — scale up or down to suit your prep batch size.
                    </Text>
                  </View>

                  {Array.isArray(batchRecipe.ingredients) && batchRecipe.ingredients.map((b: any, i: number) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                      <Text style={{ fontFamily: theme.fontBody, fontSize: 13, color: c.text }}>{b.name}</Text>
                      <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 13, color: c.text }}>{b.qty} {b.unit}</Text>
                    </View>
                  ))}

                  {Number.isFinite(batchRecipe.coldWaterMl) && batchRecipe.coldWaterMl > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                      <Text style={{ fontFamily: theme.fontBody, fontSize: 13, color: c.text }}>Cold water</Text>
                      <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 13, color: c.text }}>{batchRecipe.coldWaterMl} ml</Text>
                    </View>
                  )}

                  {!!batchRecipe.storageNotes && (
                    <Text style={{ fontFamily: theme.fontBody, fontSize: 12, color: c.textSecondary, marginTop: 8 }}>
                      {batchRecipe.storageNotes}
                    </Text>
                  )}
                  {!!batchRecipe.shelfLife && (
                    <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 12, color: c.text, marginTop: 4 }}>
                      Shelf life: {batchRecipe.shelfLife}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Bartender / chef notes */}
          {!!recipe.bartenderNotes && (
            <View style={{ backgroundColor: c.positiveSoft, borderRadius: 12, padding: 12, marginBottom: 24 }}>
              <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 12, color: c.positiveStrong, marginBottom: 4 }}>
                Notes
              </Text>
              <Text style={{ fontFamily: theme.fontBody, fontSize: 13, color: c.text }}>
                {recipe.bartenderNotes}
              </Text>
            </View>
          )}

          {/* Actions */}
          <TouchableOpacity
            onPress={handleSave}
            style={{ backgroundColor: c.deepBlue, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 12 }}
          >
            <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 15, color: c.primaryText }}>
              ✓ Save as draft
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDiscard} style={{ alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ fontFamily: theme.fontBody, fontSize: 13, color: c.textSecondary }}>Discard</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
