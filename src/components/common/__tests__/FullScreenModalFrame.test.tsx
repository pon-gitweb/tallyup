import React from 'react';
import { View, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import FullScreenModalFrame from '../FullScreenModalFrame';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  useSafeAreaInsets: jest.fn(() => ({ top: 59, bottom: 34, left: 0, right: 0 })),
}));

function getFrameStyle(rendered: ReturnType<typeof render>) {
  // The Frame renders a single host View; it is the first View in the tree.
  const views = rendered.UNSAFE_getAllByType(View);
  return views[0].props.style as any[];
}

describe('FullScreenModalFrame', () => {
  it('applies paddingTop = insets.top to the frame', () => {
    const rendered = render(
      <FullScreenModalFrame>
        <View testID="child" />
      </FullScreenModalFrame>,
    );
    const style = getFrameStyle(rendered);
    expect(style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingTop: 59 })]),
    );
  });

  it('applies paddingBottom = insets.bottom to the frame', () => {
    const rendered = render(
      <FullScreenModalFrame>
        <View testID="child" />
      </FullScreenModalFrame>,
    );
    const style = getFrameStyle(rendered);
    expect(style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 34 })]),
    );
  });

  it('sets background colour on the frame', () => {
    const rendered = render(
      <FullScreenModalFrame background="#0a0a0a">
        <View testID="child" />
      </FullScreenModalFrame>,
    );
    const style = getFrameStyle(rendered);
    expect(style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: '#0a0a0a' })]),
    );
  });

  it('renders children', () => {
    const { getByText } = render(
      <FullScreenModalFrame>
        <Text>Hello world</Text>
      </FullScreenModalFrame>,
    );
    expect(getByText('Hello world')).toBeTruthy();
  });
});
