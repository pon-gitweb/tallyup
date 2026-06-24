// @ts-nocheck
import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { collection, getDocs } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../common/Toast';
import { AI_BASE_URL } from '../../config/ai';

type RecipeType = 'cocktail' | 'drink' | 'dish' | 'batch';

const TYPE_OPTIONS: { key: RecipeType; label: string; icon: string }[] = [
  { key: 'cocktail', label: 'Cocktail', icon: '🍹' },
  { key: 'drink', label: 'Drink', icon: '☕' },
  { key: 'dish', label: 'Dish', icon: '🍽️' },
  { key: 'batch', label: 'Batch', icon: '📦' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  onRecipeGenerated: (recipe: any) => void;
  onBuildManually: () => void;
};

export default function RecipeGenerationModal({ visible, onClose, onRecipeGenerated, onBuildManually }: Props) {
  const venueId = useVenueId();
  const { theme } = useTheme();
  const c = theme.colours;
  const { showError } = useToast();
  const inputRef = useRef<TextInput>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<RecipeType>('cocktail');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setName('');
    setType('cocktail');
    setLoading(false);
  };

  const handleClose = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const handleBuildManually = () => {
    if (loading) return;
    reset();
    onBuildManually();
  };

  const generate = async () => {
    if (!name.trim()) {
      showError('Please enter a recipe name.');
      return;
    }
    if (!venueId) {
      showError('No venue selected.');
      return;
    }

    setLoading(true);
    try {
      const [productsSnap, suppliersSnap] = await Promise.all([
        getDocs(collection(db, 'venues', venueId, 'products')),
        getDocs(collection(db, 'venues', venueId, 'suppliers')),
      ]);

      const products: any[] = [];
      productsSnap.forEach((d) => {
        const x: any = d.data() || {};
        products.push({
          id: d.id,
          name: x.name ?? '(unnamed)',
          costPrice: x.costPrice ?? x.packPrice ?? x.price ?? null,
          unit: x.unit ?? x.packUnit ?? null,
          packSize: x.packSize ?? x.pack?.size ?? null,
          size: x.size ?? null,
        });
      });

      const suppliers: any[] = [];
      suppliersSnap.forEach((d) => {
        const x: any = d.data() || {};
        suppliers.push({ name: x.name ?? '(unnamed)' });
      });

      const token = await getAuth().currentUser?.getIdToken();
      const resp = await fetch(`${AI_BASE_URL}/api/generate-recipe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ venueId, name: name.trim(), type, products, suppliers }),
      });

      const json = await resp.json().catch(() => ({}));

      if (resp.status === 429) {
        showError(json?.message || 'Recipe generation limit reached for this month.');
        setLoading(false);
        return;
      }

      if (!resp.ok || !json?.ok) {
        showError(json?.error || 'Could not generate a recipe. Please try again.');
        setLoading(false);
        return;
      }

      setLoading(false);
      reset();
      onRecipeGenerated({ ...json, _type: type, _products: products });
    } catch (e: any) {
      showError(e?.message || 'Could not generate a recipe. Please try again.');
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={{
              backgroundColor: c.oat,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingTop: 10,
              paddingBottom: 28,
              paddingHorizontal: 20,
              maxHeight: '90%',
            }}
          >
            {loading ? (
              <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
                <ActivityIndicator size="large" color={c.deepBlue} />
                <Text
                  style={{
                    marginTop: 16,
                    fontFamily: theme.fontTitle,
                    fontSize: 18,
                    color: c.text,
                    textAlign: 'center',
                  }}
                >
                  Generating your recipe…
                </Text>
                <Text
                  style={{
                    marginTop: 6,
                    fontFamily: theme.fontBody,
                    fontSize: 13,
                    color: c.textSecondary,
                    textAlign: 'center',
                  }}
                >
                  Matching ingredients to your products and pricing it up.
                </Text>
              </View>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {/* Handle */}
                <View style={{ alignItems: 'center', marginBottom: 12 }}>
                  <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: c.oatMuted }} />
                </View>

                <Text
                  style={{
                    fontFamily: theme.fontTitleBold,
                    fontSize: 22,
                    color: c.text,
                    marginBottom: 4,
                  }}
                >
                  ✦ Generate with AI
                </Text>
                <Text
                  style={{
                    fontFamily: theme.fontBody,
                    fontSize: 13,
                    color: c.textSecondary,
                    marginBottom: 18,
                  }}
                >
                  Tell us what you'd like to make — we'll build a complete recipe matched to your products.
                </Text>

                <Text
                  style={{
                    fontFamily: theme.fontBodySemiBold,
                    fontSize: 13,
                    color: c.text,
                    marginBottom: 8,
                  }}
                >
                  Recipe name
                </Text>
                <TextInput
                  ref={inputRef}
                  autoFocus
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g., Espresso Martini"
                  placeholderTextColor={c.slateMid}
                  style={{
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontFamily: theme.fontBody,
                    fontSize: 15,
                    color: c.text,
                    backgroundColor: c.surface,
                    marginBottom: 18,
                  }}
                />

                <Text
                  style={{
                    fontFamily: theme.fontBodySemiBold,
                    fontSize: 13,
                    color: c.text,
                    marginBottom: 8,
                  }}
                >
                  Type
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 22 }}>
                  {TYPE_OPTIONS.map((opt) => {
                    const active = type === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        onPress={() => setType(opt.key)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 8,
                          paddingHorizontal: 14,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: active ? c.deepBlue : c.border,
                          backgroundColor: active ? c.deepBlue : c.surface,
                          marginRight: 8,
                          marginBottom: 8,
                        }}
                      >
                        <Text style={{ fontSize: 15, marginRight: 6 }}>{opt.icon}</Text>
                        <Text
                          style={{
                            fontFamily: theme.fontBodySemiBold,
                            fontSize: 13,
                            color: active ? c.primaryText : c.text,
                          }}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  onPress={generate}
                  style={{
                    backgroundColor: c.deepBlue,
                    borderRadius: 14,
                    paddingVertical: 15,
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 15, color: c.primaryText }}>
                    ✦ Generate
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={handleBuildManually} style={{ alignItems: 'center', paddingVertical: 8 }}>
                  <Text style={{ fontFamily: theme.fontBodyMedium, fontSize: 13, color: c.deepBlue }}>
                    Build manually instead
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={handleClose} style={{ alignItems: 'center', paddingVertical: 8 }}>
                  <Text style={{ fontFamily: theme.fontBody, fontSize: 13, color: c.textSecondary }}>
                    Cancel
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
